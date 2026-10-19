import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import { chatMessageEventSchema } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import {
  CHAT_MAX_UNANSWERED_MESSAGES,
  CHAT_SEND_RATE_LIMIT,
  CHAT_SEND_RATE_WINDOW_MS,
} from './chat-config';
import type { ChatShopInfo } from './chat-directory';
import { ChatService, type ChatActor } from './chat.service';

const CONVERSATION_ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const BUYER = 'buyer-1';
const OWNER = 'owner-1';
const SHOP_ID = 'c4ca4238-a0b9-4382-8dcc-509a6f75849b';
const CLIENT_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const NOW = new Date('2030-01-02T12:00:00.000Z');
const CREATED_AT = new Date('2030-01-02T12:00:00.500Z');

const buyerActor: ChatActor = { kind: 'BUYER', userId: BUYER };
const shopActor: ChatActor = { kind: 'SHOP', userId: OWNER, shopId: SHOP_ID };

const conversationRow = () => ({
  id: CONVERSATION_ID,
  buyerId: BUYER,
  shopId: SHOP_ID,
  buyerLastReadAt: null,
  lastMessageAt: null,
});
const shopInfo = (overrides: Partial<ChatShopInfo> = {}): ChatShopInfo => ({
  id: SHOP_ID,
  ownerId: OWNER,
  status: ShopStatus.APPROVED,
  name: 'Shop Áo',
  logoUrl: null,
  ...overrides,
});
const messageRow = (overrides: Record<string, unknown> = {}) => ({
  id: '6512bd43-d9ca-4e3a-9a1b-4f8c5d2e7b90',
  conversationId: CONVERSATION_ID,
  senderId: BUYER,
  content: 'xin chào',
  createdAt: CREATED_AT,
  clientMessageId: CLIENT_ID,
  ...overrides,
});
const uniqueViolation = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });

describe('ChatService.sendMessage', () => {
  let service: ChatService;
  let realtime: FakeRealtimeEmitter;
  let prisma: {
    conversation: { findUnique: jest.Mock; updateMany: jest.Mock };
    message: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let directory: { getShopForChat: jest.Mock };
  let events: string[];
  // Số sự kiện real-time đã được đẩy vào lúc transaction commit (phải là 0: đẩy chỉ SAU commit).
  let emittedAtCommit = -1;

  const send = (
    actor: ChatActor = buyerActor,
    content = 'xin chào',
    conversationId = CONVERSATION_ID,
  ) =>
    service.sendMessage(actor, conversationId, {
      content,
      clientMessageId: CLIENT_ID,
    });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    events = [];
    emittedAtCommit = -1;
    realtime = createFakeRealtimeEmitter();
    prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue(conversationRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      message: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            events.push('create');
            return Promise.resolve(messageRow(data));
          }),
      },
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const result = await callback(prisma);
          events.push('commit');
          emittedAtCommit = realtime.emitted.length;
          return result;
        },
      ),
    };
    directory = { getShopForChat: jest.fn().mockResolvedValue(shopInfo()) };
    service = new ChatService(
      prisma as unknown as PrismaService,
      directory,
      realtime,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const nothingWritten = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(realtime.emitted).toEqual([]);
  };

  describe('xác định thành viên theo DB (không phải thành viên ⇒ 404)', () => {
    it('người mua của hội thoại gửi được', async () => {
      const result = await send(buyerActor);

      expect(result.replayed).toBe(false);
      expect(result.message.senderRole).toBe('BUYER');
    });

    it('chủ shop của hội thoại (đi route của shop) gửi được, vai SHOP', async () => {
      prisma.message.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(messageRow(data)),
      );

      const result = await send(shopActor);

      expect(result.message.senderRole).toBe('SHOP');
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ senderId: OWNER }) as unknown,
        }),
      );
    });

    it.each<[string, ChatActor]>([
      ['người mua KHÁC', { kind: 'BUYER', userId: 'buyer-2' }],
      [
        'chủ shop đi nhầm sang route của NGƯỜI MUA (không phải người mua của hội thoại)',
        { kind: 'BUYER', userId: OWNER },
      ],
      ['người lạ đi route người mua', { kind: 'BUYER', userId: 'stranger' }],
      [
        'chủ một shop KHÁC (shopId route khác shop của hội thoại)',
        { kind: 'SHOP', userId: 'owner-2', shopId: 'shop-2' },
      ],
      [
        'chủ shop khác mạo shopId của hội thoại (route khớp nhưng không phải chủ)',
        { kind: 'SHOP', userId: 'owner-2', shopId: SHOP_ID },
      ],
      [
        'chủ đúng nhưng shopId route sai',
        { kind: 'SHOP', userId: OWNER, shopId: 'shop-2' },
      ],
      [
        'người mua đi route của shop',
        { kind: 'SHOP', userId: BUYER, shopId: SHOP_ID },
      ],
    ])('%s ⇒ 404, không ghi gì', async (_name, actor) => {
      await expect(send(actor)).rejects.toBeInstanceOf(NotFoundException);

      nothingWritten();
    });

    it('hội thoại không tồn tại ⇒ 404 (cùng thông điệp với "không phải thành viên")', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      const missing = await send(buyerActor).catch((e: Error) => e);
      prisma.conversation.findUnique.mockResolvedValue(conversationRow());
      const notMember = await send({ kind: 'BUYER', userId: 'buyer-2' }).catch(
        (e: Error) => e,
      );

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(notMember).toBeInstanceOf(NotFoundException);
      expect((missing as Error).message).toBe((notMember as Error).message);
      nothingWritten();
    });

    it('vai suy ra từ dữ liệu DB: người gửi giả trường senderId/senderRole trong input bị bỏ qua', async () => {
      const result = await service.sendMessage(buyerActor, CONVERSATION_ID, {
        content: 'hi',
        clientMessageId: CLIENT_ID,
        senderId: 'victim',
        senderRole: 'SHOP',
      } as never);

      expect(result.message.senderRole).toBe('BUYER');
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ senderId: BUYER }) as unknown,
        }),
      );
    });
  });

  describe('shop không còn nhận tin', () => {
    it.each([ShopStatus.PENDING, ShopStatus.REJECTED, ShopStatus.SUSPENDED])(
      'shop %s ⇒ 409 CHAT_SHOP_UNAVAILABLE cho cả hai phía, không ghi',
      async (status) => {
        directory.getShopForChat.mockResolvedValue(shopInfo({ status }));

        await expectAppException(send(buyerActor), {
          status: 409,
          code: 'CHAT_SHOP_UNAVAILABLE',
        });
        await expectAppException(send(shopActor), {
          status: 409,
          code: 'CHAT_SHOP_UNAVAILABLE',
        });

        nothingWritten();
      },
    );
  });

  describe('nội dung được kiểm lại trong service (không tin người gọi đã validate)', () => {
    it.each([
      ['rỗng', ''],
      ['chỉ khoảng trắng', '   \n  '],
      ['quá dài (1001 ký tự)', 'a'.repeat(1001)],
      ['có NUL', 'xin\u0000chào'],
      ['có bidi-override', 'xin‮chào'],
      ['có tab', 'xin\tchào'],
    ])('%s ⇒ 400, không chạm DB', async (_name, content) => {
      await expect(send(buyerActor, content)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
      nothingWritten();
    });

    it('ghi bản đã chuẩn hoá: trim + CRLF → LF', async () => {
      await send(buyerActor, '  dòng 1\r\ndòng 2  ');

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'dòng 1\ndòng 2',
          }) as unknown,
        }),
      );
    });

    it('<script>, <img onerror> được lưu NGUYÊN như chữ', async () => {
      await send(
        buyerActor,
        '<img src=x onerror=alert(1)><script>alert(2)</script>',
      );

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: '<img src=x onerror=alert(1)><script>alert(2)</script>',
          }) as unknown,
        }),
      );
    });
  });

  describe('idempotency theo clientMessageId', () => {
    it('gửi lại tin ĐÃ nhận ⇒ trả đúng tin cũ, replayed, không ghi, không đẩy lại', async () => {
      prisma.message.findUnique.mockResolvedValue(
        messageRow({ id: 'msg-old' }),
      );

      const result = await send(buyerActor);

      expect(result.replayed).toBe(true);
      expect(result.message.id).toBe('msg-old');
      expect(result.message.clientMessageId).toBe(CLIENT_ID);
      expect(prisma.message.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId_senderId_clientMessageId: {
              conversationId: CONVERSATION_ID,
              senderId: BUYER,
              clientMessageId: CLIENT_ID,
            },
          },
        }),
      );
      nothingWritten();
    });

    it('gửi lại đứng TRƯỚC các giới hạn: đã chạm trần tốc độ/trần chưa trả lời vẫn nhận lại được tin cũ', async () => {
      prisma.message.findUnique.mockResolvedValue(
        messageRow({ id: 'msg-old' }),
      );
      prisma.message.count.mockResolvedValue(999);

      await expect(send(buyerActor)).resolves.toMatchObject({ replayed: true });

      expect(prisma.message.count).not.toHaveBeenCalled();
    });

    it('khoá idempotent tính theo (hội thoại, NGƯỜI GỬI, clientMessageId): cùng khoá nhưng người khác ⇒ không phải gửi lại', async () => {
      await send(shopActor);

      expect(prisma.message.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId_senderId_clientMessageId: {
              conversationId: CONVERSATION_ID,
              senderId: OWNER,
              clientMessageId: CLIENT_ID,
            },
          },
        }),
      );
    });

    it('thua đua (P2002 của Message) ⇒ đọc lại tin của người thắng, replayed, không đẩy', async () => {
      prisma.message.create.mockRejectedValue(
        uniqueViolation({
          modelName: 'Message',
          target: ['conversation_id', 'sender_id', 'client_message_id'],
        }),
      );
      prisma.message.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(messageRow({ id: 'msg-winner' }));

      const result = await send(buyerActor);

      expect(result).toMatchObject({ replayed: true });
      expect(result.message.id).toBe('msg-winner');
      expect(realtime.emitted).toEqual([]);
    });

    it('P2002 của model KHÁC ⇒ ném lỗi gốc', async () => {
      const error = uniqueViolation({ modelName: 'Conversation' });
      prisma.message.create.mockRejectedValue(error);

      await expect(send(buyerActor)).rejects.toBe(error);
    });

    it('P2002 mà không đọc lại được tin ⇒ ném lỗi gốc', async () => {
      const error = uniqueViolation({ modelName: 'Message' });
      prisma.message.create.mockRejectedValue(error);

      await expect(send(buyerActor)).rejects.toBe(error);
    });
  });

  describe('ghi tin + cập nhật hội thoại trong MỘT transaction', () => {
    it('tạo tin đúng dữ liệu rồi nâng last_message_at và mốc đã đọc của NGƯỜI MUA (không đụng mốc của shop)', async () => {
      const result = await send(buyerActor, 'xin chào');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: CONVERSATION_ID,
          senderId: BUYER,
          content: 'xin chào',
          clientMessageId: CLIENT_ID,
        },
        select: expect.any(Object) as unknown,
      });
      const calls = prisma.conversation.updateMany.mock.calls as [
        { where: Record<string, unknown>; data: Record<string, unknown> },
      ][];
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toEqual({
        where: {
          id: CONVERSATION_ID,
          OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: CREATED_AT } }],
        },
        data: { lastMessageAt: CREATED_AT },
      });
      expect(calls[1][0]).toEqual({
        where: {
          id: CONVERSATION_ID,
          OR: [
            { buyerLastReadAt: null },
            { buyerLastReadAt: { lt: CREATED_AT } },
          ],
        },
        data: { buyerLastReadAt: CREATED_AT },
      });
      expect(JSON.stringify(calls)).not.toContain('shopLastReadAt');
      expect(result.message).toMatchObject({
        id: '6512bd43-d9ca-4e3a-9a1b-4f8c5d2e7b90',
        conversationId: CONVERSATION_ID,
        senderRole: 'BUYER',
        content: 'xin chào',
        createdAt: CREATED_AT.toISOString(),
        clientMessageId: CLIENT_ID,
      });
    });

    it('chủ shop gửi ⇒ nâng mốc đã đọc của SHOP, không đụng mốc của người mua', async () => {
      prisma.message.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(messageRow(data)),
      );

      await send(shopActor);

      const calls = prisma.conversation.updateMany.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(calls.map(([args]) => args.data)).toEqual([
        { lastMessageAt: CREATED_AT },
        { shopLastReadAt: CREATED_AT },
      ]);
    });

    it('các cột chỉ TĂNG: điều kiện `lt` nằm trong WHERE của UPDATE (không đọc-rồi-ghi)', async () => {
      await send(buyerActor);

      for (const [args] of prisma.conversation.updateMany.mock.calls as [
        { where: { OR: unknown[] } },
      ][]) {
        expect(JSON.stringify(args.where.OR)).toContain('"lt"');
      }
    });

    it('ghi tin lỗi ⇒ ném lỗi, KHÔNG đẩy real-time', async () => {
      const error = new Error('db down');
      prisma.message.create.mockRejectedValue(error);

      await expect(send(buyerActor)).rejects.toBe(error);

      expect(realtime.emitted).toEqual([]);
    });

    it('cập nhật hội thoại lỗi (cùng transaction) ⇒ ném lỗi, KHÔNG đẩy real-time', async () => {
      const error = new Error('update failed');
      prisma.conversation.updateMany.mockRejectedValue(error);

      await expect(send(buyerActor)).rejects.toBe(error);

      expect(realtime.emitted).toEqual([]);
    });
  });

  describe('giới hạn tốc độ (CHAT_RATE_LIMITED)', () => {
    it('đếm tin của đúng người gửi, trên MỌI hội thoại, trong cửa sổ ngắn tính từ bây giờ', async () => {
      await send(buyerActor);

      expect(prisma.message.count).toHaveBeenCalledWith({
        where: {
          senderId: BUYER,
          createdAt: { gt: new Date(NOW.getTime() - CHAT_SEND_RATE_WINDOW_MS) },
        },
      });
    });

    it.each([
      [0, true],
      [CHAT_SEND_RATE_LIMIT - 1, true],
      [CHAT_SEND_RATE_LIMIT, false],
      [CHAT_SEND_RATE_LIMIT + 5, false],
    ])('đã gửi %i tin trong cửa sổ ⇒ cho phép: %s', async (recent, allowed) => {
      prisma.message.count.mockImplementation(
        ({ where }: { where: { conversationId?: string } }) =>
          // chỉ phép đếm tốc độ (không có conversationId) trả `recent`; phép đếm chưa-trả-lời trả 0
          Promise.resolve(where.conversationId ? 0 : recent),
      );

      const attempt = send(shopActor);

      if (allowed) {
        await expect(attempt).resolves.toBeDefined();
      } else {
        await expectAppException(attempt, {
          status: 429,
          code: 'CHAT_RATE_LIMITED',
        });
        nothingWritten();
      }
    });

    it('áp cho cả chủ shop (không chỉ người mua)', async () => {
      prisma.message.count.mockResolvedValue(CHAT_SEND_RATE_LIMIT);

      await expectAppException(send(shopActor), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
    });

    it('cửa sổ trượt theo đồng hồ, không giữ trạng thái giữa các lần gọi', async () => {
      await send(buyerActor);
      jest.setSystemTime(new Date(NOW.getTime() + 10_000));
      await service.sendMessage(buyerActor, CONVERSATION_ID, {
        content: 'tin 2',
        clientMessageId: '9b1e0c52-3f64-4a8e-b6a2-5d7c8e1f2a33',
      });

      const since = (
        prisma.message.count.mock.calls as [
          { where: { createdAt: { gt: Date } } },
        ][]
      )
        .map(([args]) => args.where.createdAt?.gt?.getTime())
        .filter((value): value is number => typeof value === 'number');
      expect(since[1] - since[0]).toBe(10_000);
    });
  });

  describe('trần tin liên tiếp chưa được trả lời (CHAT_AWAITING_REPLY)', () => {
    const SHOP_LAST = new Date('2030-01-02T11:00:00.000Z');

    it('đếm tin của người mua SAU tin cuối của shop trong đúng hội thoại này', async () => {
      prisma.message.findFirst.mockResolvedValue({ createdAt: SHOP_LAST });

      await send(buyerActor);

      expect(prisma.message.findFirst).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID, senderId: { not: BUYER } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: {
          conversationId: CONVERSATION_ID,
          senderId: BUYER,
          createdAt: { gt: SHOP_LAST },
        },
      });
    });

    it('shop chưa từng trả lời ⇒ đếm mọi tin của người mua, không lọc theo thời gian', async () => {
      prisma.message.findFirst.mockResolvedValue(null);

      await send(buyerActor);

      expect(prisma.message.count).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID, senderId: BUYER },
      });
    });

    it.each([
      [0, true],
      [CHAT_MAX_UNANSWERED_MESSAGES - 1, true],
      [CHAT_MAX_UNANSWERED_MESSAGES, false],
      [CHAT_MAX_UNANSWERED_MESSAGES + 3, false],
    ])(
      'người mua đã gửi %i tin chưa được trả lời ⇒ cho phép: %s',
      async (unanswered, allowed) => {
        prisma.message.count.mockImplementation(
          ({ where }: { where: { conversationId?: string } }) =>
            Promise.resolve(where.conversationId ? unanswered : 0),
        );

        const attempt = send(buyerActor);

        if (allowed) {
          await expect(attempt).resolves.toBeDefined();
        } else {
          await expectAppException(attempt, {
            status: 429,
            code: 'CHAT_AWAITING_REPLY',
          });
          nothingWritten();
        }
      },
    );

    it('KHÔNG áp cho chủ shop: shop trả lời bao nhiêu tin cũng được (chỉ bị giới hạn tốc độ)', async () => {
      prisma.message.count.mockImplementation(
        ({ where }: { where: { conversationId?: string } }) =>
          Promise.resolve(where.conversationId ? 999 : 0),
      );

      await expect(send(shopActor)).resolves.toBeDefined();

      expect(prisma.message.findFirst).not.toHaveBeenCalled();
    });

    it('vừa quá tốc độ vừa chưa được trả lời ⇒ báo RATE_LIMITED (kiểm tốc độ trước)', async () => {
      prisma.message.count.mockResolvedValue(999);

      await expectAppException(send(buyerActor), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
    });
  });

  describe('đẩy real-time sau commit', () => {
    const payloadOf = (index: number) =>
      chatMessageEventSchema.parse(realtime.emitted[index].payload);

    it('người mua gửi ⇒ đẩy tới CẢ HAI phía; chỉ bản của người gửi mang clientMessageId', async () => {
      await send(buyerActor);

      expect(realtime.emitted).toHaveLength(2);
      const byUser = new Map(realtime.emitted.map((e) => [e.userId, e]));
      expect([...byUser.keys()].sort()).toEqual([BUYER, OWNER].sort());
      for (const emitted of realtime.emitted)
        expect(emitted.event).toBe('chat:message');

      const buyerCopy = chatMessageEventSchema.parse(
        byUser.get(BUYER)?.payload,
      );
      const shopCopy = chatMessageEventSchema.parse(byUser.get(OWNER)?.payload);
      expect(buyerCopy).toMatchObject({ viewerRole: 'BUYER', shopId: SHOP_ID });
      expect(shopCopy).toMatchObject({ viewerRole: 'SHOP', shopId: SHOP_ID });
      expect(buyerCopy.message.clientMessageId).toBe(CLIENT_ID);
      expect(shopCopy.message.clientMessageId).toBeUndefined();
      expect(shopCopy.message).toMatchObject({
        id: '6512bd43-d9ca-4e3a-9a1b-4f8c5d2e7b90',
        senderRole: 'BUYER',
        content: 'xin chào',
      });
    });

    it('chủ shop gửi ⇒ bản mang clientMessageId là của CHỦ SHOP', async () => {
      prisma.message.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(messageRow(data)),
      );

      await send(shopActor);

      const byUser = new Map(realtime.emitted.map((e) => [e.userId, e]));
      const ownerCopy = chatMessageEventSchema.parse(
        byUser.get(OWNER)?.payload,
      );
      const buyerCopy = chatMessageEventSchema.parse(
        byUser.get(BUYER)?.payload,
      );
      expect(ownerCopy.message.clientMessageId).toBe(CLIENT_ID);
      expect(buyerCopy.message.clientMessageId).toBeUndefined();
      expect(buyerCopy.viewerRole).toBe('BUYER');
      expect(buyerCopy.message.senderRole).toBe('SHOP');
    });

    it('chỉ đẩy SAU khi transaction đã commit: lúc commit chưa có sự kiện nào, sau đó có đủ hai', async () => {
      await send(buyerActor);

      expect(events).toContain('commit');
      expect(emittedAtCommit).toBe(0);
      expect(realtime.emitted).toHaveLength(2);
    });

    it('payload không chứa thông tin ngoài tin nhắn: không email, không tên, không id chủ shop ngoài phần người nhận', async () => {
      await send(buyerActor);

      for (let i = 0; i < realtime.emitted.length; i++) {
        const serialized = JSON.stringify(payloadOf(i));
        expect(serialized).not.toMatch(/@|Shop Áo/);
        expect(Object.keys(payloadOf(i)).sort()).toEqual([
          'message',
          'shopId',
          'viewerRole',
        ]);
      }
    });

    it('đẩy lỗi (reject) ⇒ KHÔNG làm hỏng việc gửi; chỉ log id, tuyệt đối không log nội dung tin', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      realtime.failWith(new Error('socket down'));

      const result = await send(buyerActor, 'nội dung riêng tư của người mua');

      expect(result.replayed).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).toContain('6512bd43-d9ca-4e3a-9a1b-4f8c5d2e7b90');
      expect(logged).toContain('socket down');
      expect(logged).not.toContain('nội dung riêng tư');
    });

    it('đẩy lỗi (ném đồng bộ) cũng không làm hỏng việc gửi', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      jest.spyOn(realtime, 'emitToUser').mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(send(buyerActor)).resolves.toMatchObject({
        replayed: false,
      });
    });

    it('gửi thành công không ghi log nào (nhất là không có nội dung tin)', async () => {
      const spies = (['log', 'debug', 'verbose', 'warn', 'error'] as const).map(
        (level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );

      await send(buyerActor, 'bí mật');

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  });
});
