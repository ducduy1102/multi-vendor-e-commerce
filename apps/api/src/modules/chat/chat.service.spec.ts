import { NotFoundException } from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import { CHAT_PREVIEW_MAX_LENGTH } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { createFakeRealtimeEmitter } from '../../shared/testing/fake-realtime-emitter';
import {
  CHAT_NEW_CONVERSATIONS_LIMIT,
  CHAT_NEW_CONVERSATIONS_WINDOW_MS,
} from './chat-config';
import type { ChatShopInfo } from './chat-directory';
import { ChatService } from './chat.service';

const BUYER = 'buyer-1';
const OWNER = 'owner-1';
const SHOP_ID = 'shop-1';
const NOW = new Date('2030-01-02T12:00:00.000Z');

const shop = (overrides: Partial<ChatShopInfo> = {}): ChatShopInfo => ({
  id: SHOP_ID,
  ownerId: OWNER,
  status: ShopStatus.APPROVED,
  name: 'Shop Áo',
  logoUrl: 'https://img.example/logo.png',
  ...overrides,
});
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  buyerId: BUYER,
  shopId: SHOP_ID,
  buyerLastReadAt: null as Date | null,
  lastMessageAt: null as Date | null,
  ...overrides,
});
const uniqueViolation = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });

describe('ChatService.openConversation', () => {
  let service: ChatService;
  let prisma: {
    conversation: {
      findUnique: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    message: { findFirst: jest.Mock; count: jest.Mock };
    shop: { findUnique: jest.Mock };
  };
  let directory: {
    getShopForChat: jest.Mock;
    getShopsForChat: jest.Mock;
    getUserDisplay: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(0),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      shop: { findUnique: jest.fn() },
    };
    directory = {
      getShopForChat: jest.fn().mockResolvedValue(shop()),
      getShopsForChat: jest.fn(),
      getUserDisplay: jest.fn(),
    };
    service = new ChatService(
      prisma as unknown as PrismaService,
      directory,
      createFakeRealtimeEmitter(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const noWrites = () => {
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  };

  describe('kiểm tra shop', () => {
    it('shop không tồn tại ⇒ 404, không đụng DB hội thoại', async () => {
      directory.getShopForChat.mockResolvedValue(null);

      await expect(
        service.openConversation(BUYER, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
      noWrites();
    });

    it.each([ShopStatus.PENDING, ShopStatus.REJECTED, ShopStatus.SUSPENDED])(
      'shop %s (chưa/không còn APPROVED) ⇒ 404 như trang công khai',
      async (status) => {
        directory.getShopForChat.mockResolvedValue(shop({ status }));

        await expect(
          service.openConversation(BUYER, SHOP_ID),
        ).rejects.toBeInstanceOf(NotFoundException);

        noWrites();
      },
    );

    it('chủ shop mở hội thoại với shop của CHÍNH MÌNH ⇒ 409 CHAT_OWN_SHOP, không tạo gì', async () => {
      await expectAppException(service.openConversation(OWNER, SHOP_ID), {
        status: 409,
        code: 'CHAT_OWN_SHOP',
      });

      noWrites();
      expect(prisma.conversation.count).not.toHaveBeenCalled();
    });

    it('shop chưa duyệt kiểm TRƯỚC khi báo shop của chính mình (không phân biệt được cho người ngoài)', async () => {
      directory.getShopForChat.mockResolvedValue(
        shop({ status: ShopStatus.PENDING }),
      );

      await expect(
        service.openConversation(OWNER, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('chỉ hỏi thông tin shop qua cổng ChatDirectory, không đọc bảng shop trực tiếp', async () => {
      await service.openConversation(BUYER, SHOP_ID);

      expect(directory.getShopForChat).toHaveBeenCalledWith(SHOP_ID);
      expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('tạo hội thoại mới', () => {
    it('chưa có ⇒ tạo đúng (người mua, shop) và trả tóm tắt hội thoại rỗng', async () => {
      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { buyerId: BUYER, shopId: SHOP_ID },
        }),
      );
      expect(result).toEqual({
        id: 'conv-1',
        shopId: SHOP_ID,
        counterpart: {
          name: 'Shop Áo',
          logoUrl: 'https://img.example/logo.png',
        },
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
        otherLastReadAt: null,
        isReadOnly: false,
      });
      // Hội thoại chưa có tin không tốn thêm truy vấn tin nhắn.
      expect(prisma.message.findFirst).not.toHaveBeenCalled();
      expect(prisma.message.count).not.toHaveBeenCalled();
    });

    it('người gọi lấy từ token (buyerId), shop lấy từ DB: dữ liệu ghi dùng id của hàng shop, không phải chuỗi client gửi', async () => {
      directory.getShopForChat.mockResolvedValue(shop({ id: 'shop-from-db' }));

      await service.openConversation(BUYER, 'whatever-client-sent');

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { buyerId: BUYER, shopId: 'shop-from-db' },
        }),
      );
    });

    it('tóm tắt chỉ có tên + logo shop: không lộ chủ shop hay trường lạ', async () => {
      directory.getShopForChat.mockResolvedValue({
        ...shop(),
        ownerEmail: 'owner@example.com',
      });

      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(JSON.stringify(result)).not.toMatch(
        /owner@example\.com|owner-1|ownerId/,
      );
    });
  });

  describe('hội thoại đã có (idempotent)', () => {
    it('trả lại hội thoại cũ, không tạo thêm', async () => {
      prisma.conversation.findUnique.mockResolvedValue(row({ id: 'conv-old' }));

      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(result.id).toBe('conv-old');
      noWrites();
    });

    it('otherLastReadAt là mốc đọc của SHOP (đối phương), không phải mốc của chính người mua', async () => {
      const BUYER_READ = new Date('2030-01-02T09:00:00.000Z');
      const SHOP_READ = new Date('2030-01-02T10:00:00.000Z');
      prisma.conversation.findUnique.mockResolvedValue(
        row({ buyerLastReadAt: BUYER_READ, shopLastReadAt: SHOP_READ }),
      );

      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(result.otherLastReadAt).toBe(SHOP_READ.toISOString());
    });

    it('shop chưa đọc lần nào ⇒ otherLastReadAt là null', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        row({ buyerLastReadAt: new Date('2030-01-02T09:00:00.000Z') }),
      );

      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(result.otherLastReadAt).toBeNull();
    });

    it('tra theo đúng khoá (người mua, shop)', async () => {
      await service.openConversation(BUYER, SHOP_ID);

      expect(prisma.conversation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buyerId_shopId: { buyerId: BUYER, shopId: SHOP_ID } },
        }),
      );
    });

    it('mở lại KHÔNG tính vào trần hội thoại mới: đã đủ trần vẫn mở lại được hội thoại cũ', async () => {
      prisma.conversation.findUnique.mockResolvedValue(row());
      prisma.conversation.count.mockResolvedValue(
        CHAT_NEW_CONVERSATIONS_LIMIT + 50,
      );

      await expect(
        service.openConversation(BUYER, SHOP_ID),
      ).resolves.toMatchObject({ id: 'conv-1' });

      expect(prisma.conversation.count).not.toHaveBeenCalled();
    });

    describe('có tin nhắn', () => {
      const READ_AT = new Date('2030-01-02T10:00:00.000Z');
      const LAST_AT = new Date('2030-01-02T11:30:00.000Z');
      const withMessages = (overrides: Record<string, unknown> = {}) =>
        row({ lastMessageAt: LAST_AT, buyerLastReadAt: READ_AT, ...overrides });

      it('tin cuối của SHOP: vai SHOP, thời điểm ISO, chưa đọc đếm theo mốc đã đọc của người mua', async () => {
        prisma.conversation.findUnique.mockResolvedValue(withMessages());
        prisma.message.findFirst.mockResolvedValue({
          content: 'Còn hàng nhé',
          senderId: OWNER,
          createdAt: LAST_AT,
        });
        prisma.message.count.mockResolvedValue(2);

        const result = await service.openConversation(BUYER, SHOP_ID);

        expect(result.lastMessage).toEqual({
          content: 'Còn hàng nhé',
          senderRole: 'SHOP',
          createdAt: LAST_AT.toISOString(),
        });
        expect(result.lastMessageAt).toBe(LAST_AT.toISOString());
        expect(result.unreadCount).toBe(2);
        // Chưa đọc = tin do ĐỐI PHƯƠNG gửi (không phải người mua) và sau mốc đã đọc.
        expect(prisma.message.count).toHaveBeenCalledWith({
          where: {
            conversationId: 'conv-1',
            senderId: { not: BUYER },
            createdAt: { gt: READ_AT },
          },
        });
      });

      it('tin cuối của chính NGƯỜI MUA ⇒ vai BUYER', async () => {
        prisma.conversation.findUnique.mockResolvedValue(withMessages());
        prisma.message.findFirst.mockResolvedValue({
          content: 'mình đặt nhé',
          senderId: BUYER,
          createdAt: LAST_AT,
        });

        const result = await service.openConversation(BUYER, SHOP_ID);

        expect(result.lastMessage?.senderRole).toBe('BUYER');
      });

      it('chưa đọc lần nào (mốc NULL) ⇒ đếm mọi tin của đối phương, không lọc theo thời gian', async () => {
        prisma.conversation.findUnique.mockResolvedValue(
          withMessages({ buyerLastReadAt: null }),
        );
        prisma.message.findFirst.mockResolvedValue({
          content: 'xin chào',
          senderId: OWNER,
          createdAt: LAST_AT,
        });

        await service.openConversation(BUYER, SHOP_ID);

        expect(prisma.message.count).toHaveBeenCalledWith({
          where: { conversationId: 'conv-1', senderId: { not: BUYER } },
        });
      });

      it(`tin dài bị rút gọn về ${CHAT_PREVIEW_MAX_LENGTH} ký tự, xuống dòng thành dấu cách`, async () => {
        prisma.conversation.findUnique.mockResolvedValue(withMessages());
        prisma.message.findFirst.mockResolvedValue({
          content: `dòng một\ndòng hai ${'x'.repeat(500)}`,
          senderId: OWNER,
          createdAt: LAST_AT,
        });

        const result = await service.openConversation(BUYER, SHOP_ID);

        const preview = result.lastMessage?.content ?? '';
        expect(Array.from(preview)).toHaveLength(CHAT_PREVIEW_MAX_LENGTH);
        expect(preview.startsWith('dòng một dòng hai ')).toBe(true);
        expect(preview.endsWith('…')).toBe(true);
        expect(preview).not.toContain('\n');
      });

      it('lastMessageAt có nhưng không đọc ra tin (dữ liệu lệch) ⇒ lastMessage null, không ném lỗi', async () => {
        prisma.conversation.findUnique.mockResolvedValue(withMessages());
        prisma.message.findFirst.mockResolvedValue(null);

        const result = await service.openConversation(BUYER, SHOP_ID);

        expect(result.lastMessage).toBeNull();
      });
    });
  });

  describe('trần hội thoại MỚI trong ngày (CHAT_CONVERSATION_LIMIT)', () => {
    it('đếm hội thoại của đúng người mua, tạo SAU (hiện tại − 24 giờ), bằng truy vấn', async () => {
      await service.openConversation(BUYER, SHOP_ID);

      expect(prisma.conversation.count).toHaveBeenCalledWith({
        where: {
          buyerId: BUYER,
          createdAt: {
            gt: new Date(NOW.getTime() - CHAT_NEW_CONVERSATIONS_WINDOW_MS),
          },
        },
      });
    });

    it.each([
      [0, true],
      [CHAT_NEW_CONVERSATIONS_LIMIT - 1, true],
      [CHAT_NEW_CONVERSATIONS_LIMIT, false],
      [CHAT_NEW_CONVERSATIONS_LIMIT + 1, false],
    ])('đã mở %i hội thoại mới trong cửa sổ ⇒ %s', async (recent, allowed) => {
      prisma.conversation.count.mockResolvedValue(recent);

      const attempt = service.openConversation(BUYER, SHOP_ID);

      if (allowed) {
        await expect(attempt).resolves.toBeDefined();
        expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
      } else {
        await expectAppException(attempt, {
          status: 429,
          code: 'CHAT_CONVERSATION_LIMIT',
        });
        noWrites();
      }
    });

    it('cửa sổ trượt theo đồng hồ: sau 1 giờ mốc "since" dịch tương ứng (không giữ trạng thái cũ)', async () => {
      await service.openConversation(BUYER, SHOP_ID);
      jest.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
      prisma.conversation.findUnique.mockResolvedValue(null);

      await service.openConversation(BUYER, SHOP_ID);

      const sinceValues = prisma.conversation.count.mock.calls.map(
        ([args]: [{ where: { createdAt: { gt: Date } } }]) =>
          args.where.createdAt.gt.getTime(),
      );
      expect(sinceValues[1] - sinceValues[0]).toBe(60 * 60 * 1000);
    });

    it('trần tính theo từng người mua: không có trạng thái chung giữa hai người mua', async () => {
      prisma.conversation.count.mockImplementation(
        ({ where }: { where: { buyerId: string } }) =>
          Promise.resolve(where.buyerId === 'spammer' ? 99 : 0),
      );

      await expectAppException(service.openConversation('spammer', SHOP_ID), {
        status: 429,
        code: 'CHAT_CONVERSATION_LIMIT',
      });
      await expect(
        service.openConversation('honest-buyer', SHOP_ID),
      ).resolves.toBeDefined();
    });
  });

  describe('đua tạo đồng thời (P2002)', () => {
    it('thua đua ở Conversation ⇒ đọc lại hàng của người thắng và trả về, không lỗi', async () => {
      prisma.conversation.create.mockRejectedValue(
        uniqueViolation({
          modelName: 'Conversation',
          target: ['buyer_id', 'shop_id'],
        }),
      );
      prisma.conversation.findUnique
        .mockResolvedValueOnce(null) // lần kiểm đầu: chưa có
        .mockResolvedValueOnce(row({ id: 'conv-winner' })); // sau P2002: đã có

      const result = await service.openConversation(BUYER, SHOP_ID);

      expect(result.id).toBe('conv-winner');
      expect(prisma.conversation.findUnique).toHaveBeenCalledTimes(2);
    });

    it('nhận ra P2002 khi chỉ có `target` (không có modelName)', async () => {
      prisma.conversation.create.mockRejectedValue(
        uniqueViolation({ target: ['buyer_id', 'shop_id'] }),
      );
      prisma.conversation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ id: 'conv-winner' }));

      await expect(
        service.openConversation(BUYER, SHOP_ID),
      ).resolves.toMatchObject({ id: 'conv-winner' });
    });

    it('P2002 của model KHÁC ⇒ ném lỗi gốc, không đọc lại', async () => {
      const error = uniqueViolation({ modelName: 'Message', target: ['x'] });
      prisma.conversation.create.mockRejectedValue(error);

      await expect(service.openConversation(BUYER, SHOP_ID)).rejects.toBe(
        error,
      );

      expect(prisma.conversation.findUnique).toHaveBeenCalledTimes(1);
    });

    it('P2002 mà đọc lại không thấy hàng (đã bị xoá giữa chừng) ⇒ ném lỗi gốc', async () => {
      const error = uniqueViolation({ modelName: 'Conversation' });
      prisma.conversation.create.mockRejectedValue(error);

      await expect(service.openConversation(BUYER, SHOP_ID)).rejects.toBe(
        error,
      );
    });

    it('lỗi khác P2002 (DB sập) ⇒ ném nguyên', async () => {
      const error = new Error('db down');
      prisma.conversation.create.mockRejectedValue(error);

      await expect(service.openConversation(BUYER, SHOP_ID)).rejects.toBe(
        error,
      );
    });
  });
});
