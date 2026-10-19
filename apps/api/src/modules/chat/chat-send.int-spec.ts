import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, ShopStatus } from '@prisma/client';
import { chatMessageEventSchema } from '@ecommerce/types';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import {
  CHAT_MAX_UNANSWERED_MESSAGES,
  CHAT_SEND_RATE_LIMIT,
} from './chat-config';
import { ChatModule } from './chat.module';
import { ChatService, type ChatActor } from './chat.service';

// Integration test trên Postgres THẬT cho "gửi tin" (Week10.md 4.4): chứng minh điều unit test với Prisma giả không
// chứng minh được — ghi tin và nâng hội thoại trong cùng transaction, idempotency khi gửi ĐỒNG THỜI cùng một
// clientMessageId, mốc thời gian chỉ tăng khi nhiều tin commit lệch thứ tự, và các giới hạn được đếm bằng truy vấn
// nên đúng cả với một "instance" khác dùng chung DB. Real-time dùng bản giả (kết nối thật được kiểm ở e2e, 4.8).
// Chạy: `pnpm test:int`.
const TAG = 'it-chat-send-';

interface Conversation {
  conversationId: string;
  buyerId: string;
  shopId: string;
  ownerId: string;
  buyer: ChatActor;
  shop: ChatActor;
}

describe('Gửi tin chat (DB thật)', () => {
  const prisma = new PrismaClient();
  let moduleFixture: TestingModule;
  let chat: ChatService;
  let realtime: FakeRealtimeEmitter;
  let counter = 0;

  const makeShop = async (
    owner: string,
    status: ShopStatus = ShopStatus.APPROVED,
  ) =>
    (
      await prisma.shop.create({
        data: {
          ownerId: owner,
          name: `${TAG}shop`,
          slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
          status,
        },
        select: { id: true },
      })
    ).id;

  // Mỗi test dựng người mua + chủ shop + shop + hội thoại RIÊNG: các giới hạn đếm theo người gửi trên mọi hội thoại
  // nên dùng chung chủ shop giữa các test sẽ làm trần tốc độ của test này ăn vào test khác.
  const newConversation = async (
    status: ShopStatus = ShopStatus.APPROVED,
  ): Promise<Conversation> => {
    const ownerId = (await createUser(prisma, TAG)).id;
    const shopId = await makeShop(ownerId, status);
    const buyerId = (await createUser(prisma, TAG)).id;
    const { id: conversationId } = await chat.openConversation(buyerId, shopId);
    return {
      conversationId,
      buyerId,
      shopId,
      ownerId,
      buyer: { kind: 'BUYER', userId: buyerId },
      shop: { kind: 'SHOP', userId: ownerId, shopId },
    };
  };
  const send = (
    actor: ChatActor,
    conversationId: string,
    content = 'xin chào',
    clientMessageId: string = randomUUID(),
    service: ChatService = chat,
  ) => service.sendMessage(actor, conversationId, { content, clientMessageId });
  const messagesOf = (conversationId: string) =>
    prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const conversationOf = (id: string) =>
    prisma.conversation.findUniqueOrThrow({ where: { id } });

  const buildModule = async () => {
    const fake = createFakeRealtimeEmitter();
    const built = await Test.createTestingModule({
      imports: [PrismaModule, ChatModule],
    })
      .overrideProvider(REALTIME_EMITTER)
      .useValue(fake)
      .compile();
    return { built, fake };
  };

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const main = await buildModule();
    moduleFixture = main.built;
    realtime = main.fake;
    chat = moduleFixture.get(ChatService);
  });

  beforeEach(() => realtime.reset());

  afterAll(async () => {
    await moduleFixture.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('ghi tin và nâng hội thoại cùng một transaction', () => {
    it('người mua gửi: tin được lưu, last_message_at = thời điểm tin, mốc đã đọc của NGƯỜI MUA = thời điểm tin, mốc của shop không đổi', async () => {
      const { buyer, buyerId, conversationId } = await newConversation();
      const clientMessageId = randomUUID();

      const result = await send(
        buyer,
        conversationId,
        'chào shop',
        clientMessageId,
      );

      const rows = await messagesOf(conversationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        senderId: buyerId,
        content: 'chào shop',
        clientMessageId,
      });
      const conversation = await conversationOf(conversationId);
      expect(conversation.lastMessageAt?.getTime()).toBe(
        rows[0].createdAt.getTime(),
      );
      expect(conversation.buyerLastReadAt?.getTime()).toBe(
        rows[0].createdAt.getTime(),
      );
      expect(conversation.shopLastReadAt).toBeNull();
      expect(result.replayed).toBe(false);
      expect(result.message).toMatchObject({
        id: rows[0].id,
        conversationId,
        senderRole: 'BUYER',
        content: 'chào shop',
        clientMessageId,
        createdAt: rows[0].createdAt.toISOString(),
      });
    });

    it('chủ shop trả lời: mốc đã đọc của SHOP = thời điểm tin trả lời, mốc của người mua giữ nguyên', async () => {
      const { buyer, shop, conversationId } = await newConversation();
      await send(buyer, conversationId, 'có size M không');
      const afterBuyer = await conversationOf(conversationId);

      const reply = await send(shop, conversationId, 'có nhé');

      const conversation = await conversationOf(conversationId);
      expect(reply.message.senderRole).toBe('SHOP');
      expect(conversation.shopLastReadAt?.toISOString()).toBe(
        reply.message.createdAt,
      );
      expect(conversation.lastMessageAt?.toISOString()).toBe(
        reply.message.createdAt,
      );
      expect(conversation.buyerLastReadAt?.getTime()).toBe(
        afterBuyer.buyerLastReadAt?.getTime(),
      );
    });

    it('nhiều tin gửi SONG SONG: last_message_at và mốc đã đọc đúng bằng thời điểm của tin MỚI NHẤT (không lùi dù commit lệch thứ tự)', async () => {
      const { shop, conversationId } = await newConversation();

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          send(shop, conversationId, `song song ${i}`),
        ),
      );

      const rows = await messagesOf(conversationId);
      const newest = Math.max(...rows.map((r) => r.createdAt.getTime()));
      const conversation = await conversationOf(conversationId);
      expect(rows).toHaveLength(10);
      expect(conversation.lastMessageAt?.getTime()).toBe(newest);
      expect(conversation.shopLastReadAt?.getTime()).toBe(newest);
    });

    it('hội thoại nhờ đó hiện tin cuối và số chưa đọc đúng ở "mở hội thoại" (nối với 4.3)', async () => {
      const { buyer, shop, buyerId, shopId, conversationId } =
        await newConversation();
      await send(buyer, conversationId, 'chào shop');
      const afterBuyerOnly = await chat.openConversation(buyerId, shopId);

      await send(shop, conversationId, 'mình đây ạ');
      const afterReply = await chat.openConversation(buyerId, shopId);

      expect(afterBuyerOnly.unreadCount).toBe(0); // gửi tin tức là đã đọc tới đó
      expect(afterBuyerOnly.lastMessage?.senderRole).toBe('BUYER');
      expect(afterReply.unreadCount).toBe(1);
      expect(afterReply.lastMessage).toMatchObject({
        content: 'mình đây ạ',
        senderRole: 'SHOP',
      });
    });
  });

  describe('idempotency theo clientMessageId', () => {
    it('gửi lại tin đã nhận ⇒ cùng một tin, replayed, không thêm hàng, không đẩy thêm sự kiện', async () => {
      const { buyer, conversationId } = await newConversation();
      const clientMessageId = randomUUID();
      const first = await send(
        buyer,
        conversationId,
        'một lần thôi',
        clientMessageId,
      );
      realtime.reset();

      const second = await send(
        buyer,
        conversationId,
        'một lần thôi',
        clientMessageId,
      );

      expect(second.replayed).toBe(true);
      expect(second.message.id).toBe(first.message.id);
      expect(await messagesOf(conversationId)).toHaveLength(1);
      expect(realtime.emitted).toEqual([]);
    });

    it('10 request ĐỒNG THỜI cùng một clientMessageId ⇒ đúng 1 tin, một lần ghi thật, cùng một id, chỉ đẩy sự kiện MỘT lần', async () => {
      const { buyer, conversationId } = await newConversation();
      const clientMessageId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          send(buyer, conversationId, 'bấm đúp', clientMessageId),
        ),
      );

      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const values = results.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value] : [],
      );
      expect(new Set(values.map((v) => v.message.id)).size).toBe(1);
      expect(values.filter((v) => !v.replayed)).toHaveLength(1);
      expect(await messagesOf(conversationId)).toHaveLength(1);
      // Một lần gửi thật = một cặp sự kiện (người mua + chủ shop), không nhân lên theo số lần thử.
      expect(realtime.emitted).toHaveLength(2);
    });

    it('cùng clientMessageId nhưng KHÁC người gửi ⇒ là hai tin riêng (khoá gồm người gửi)', async () => {
      const { buyer, shop, conversationId } = await newConversation();
      const clientMessageId = randomUUID();

      const fromBuyer = await send(buyer, conversationId, 'a', clientMessageId);
      const fromShop = await send(shop, conversationId, 'b', clientMessageId);

      expect(fromBuyer.message.id).not.toBe(fromShop.message.id);
      expect(await messagesOf(conversationId)).toHaveLength(2);
    });
  });

  describe('ma trận quyền (không phải thành viên ⇒ 404, dữ liệu không đổi, không đẩy sự kiện)', () => {
    it('người mua khác, chủ shop khác, mạo shopId, nhầm route, hội thoại không tồn tại', async () => {
      const { buyer, buyerId, ownerId, shopId, conversationId } =
        await newConversation();
      await send(buyer, conversationId, 'tin gốc');
      const other = await newConversation();
      const before = await messagesOf(conversationId);
      const conversationBefore = await conversationOf(conversationId);
      realtime.reset();

      const attempts: Promise<unknown>[] = [
        // người mua khác
        send(other.buyer, conversationId, 'chen vào'),
        // chủ shop KHÁC, đi route shop của chính họ
        send(other.shop, conversationId, 'chen vào'),
        // chủ shop khác MẠO shopId của hội thoại (guard ở 4.6 chặn trước, service vẫn phải tự đúng)
        send(
          { kind: 'SHOP', userId: other.ownerId, shopId },
          conversationId,
          'chen vào',
        ),
        // chủ shop thật nhưng route trỏ shop khác
        send(
          { kind: 'SHOP', userId: ownerId, shopId: other.shopId },
          conversationId,
          'chen vào',
        ),
        // chủ shop đi route NGƯỜI MUA
        send({ kind: 'BUYER', userId: ownerId }, conversationId, 'chen vào'),
        // người mua đi route SHOP
        send(
          { kind: 'SHOP', userId: buyerId, shopId },
          conversationId,
          'chen vào',
        ),
        // hội thoại không tồn tại, và id sai định dạng (cột id là TEXT nên vẫn là 404, không phải lỗi DB)
        send(buyer, randomUUID(), 'chen vào'),
        send(buyer, 'khong-phai-uuid', 'chen vào'),
      ];
      const settled = await Promise.allSettled(attempts);

      for (const outcome of settled) {
        expect(outcome.status).toBe('rejected');
        expect(
          outcome.status === 'rejected' ? outcome.reason : null,
        ).toBeInstanceOf(NotFoundException);
      }
      expect(await messagesOf(conversationId)).toEqual(before);
      expect(await conversationOf(conversationId)).toEqual(conversationBefore);
      expect(realtime.emitted).toEqual([]);
    });
  });

  describe('shop không còn nhận tin', () => {
    it('shop bị khoá ⇒ 409 CHAT_SHOP_UNAVAILABLE cho cả hai phía, tin cũ còn nguyên; mở khoá ⇒ gửi lại được', async () => {
      const { buyer, shop, shopId, conversationId } = await newConversation();
      await send(buyer, conversationId, 'trước khi bị khoá');
      await prisma.shop.update({
        where: { id: shopId },
        data: { status: ShopStatus.SUSPENDED },
      });

      await expectAppException(send(buyer, conversationId, 'sau khi bị khoá'), {
        status: 409,
        code: 'CHAT_SHOP_UNAVAILABLE',
      });
      await expectAppException(send(shop, conversationId, 'shop trả lời'), {
        status: 409,
        code: 'CHAT_SHOP_UNAVAILABLE',
      });
      expect((await messagesOf(conversationId)).map((m) => m.content)).toEqual([
        'trước khi bị khoá',
      ]);

      await prisma.shop.update({
        where: { id: shopId },
        data: { status: ShopStatus.APPROVED },
      });
      await expect(
        send(buyer, conversationId, 'đã mở khoá'),
      ).resolves.toBeDefined();
    });
  });

  describe('nội dung', () => {
    it.each([
      ['NUL', 'xin\u0000chào'],
      ['bidi-override', 'xin‮chào'],
      ['quá dài (1001 ký tự)', 'a'.repeat(1001)],
      ['chỉ khoảng trắng', '   '],
    ])('%s ⇒ 400, không có hàng nào', async (_name, content) => {
      const { buyer, conversationId } = await newConversation();

      await expect(send(buyer, conversationId, content)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(await messagesOf(conversationId)).toHaveLength(0);
      expect((await conversationOf(conversationId)).lastMessageAt).toBeNull();
    });

    it('<script>, <img onerror> được lưu NGUYÊN VĂN như chữ; đúng 1000 ký tự và nhiều dòng đều qua', async () => {
      const { buyer, shop, conversationId } = await newConversation();
      const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';

      await send(buyer, conversationId, xss);
      await send(shop, conversationId, 'a'.repeat(1000));
      await send(shop, conversationId, 'dòng 1\r\ndòng 2');

      const contents = (await messagesOf(conversationId)).map((m) => m.content);
      expect(contents).toEqual([xss, 'a'.repeat(1000), 'dòng 1\ndòng 2']);
    });
  });

  describe('giới hạn tốc độ (đếm bằng DB)', () => {
    it(`chủ shop gửi ${CHAT_SEND_RATE_LIMIT} tin liên tiếp ⇒ tin thứ ${CHAT_SEND_RATE_LIMIT + 1} bị 429 CHAT_RATE_LIMITED`, async () => {
      const { shop, conversationId } = await newConversation();
      for (let i = 0; i < CHAT_SEND_RATE_LIMIT; i++) {
        await send(shop, conversationId, `tin ${i}`);
      }

      await expectAppException(send(shop, conversationId, 'tin vượt'), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });

      expect(await messagesOf(conversationId)).toHaveLength(
        CHAT_SEND_RATE_LIMIT,
      );
    });

    it('tính theo NGƯỜI GỬI trên mọi hội thoại; gửi lại tin đã nhận vẫn được dù đã chạm trần; người khác không bị ảnh hưởng', async () => {
      const first = await newConversation();
      // Hội thoại thứ hai cùng shop với hội thoại đầu, người mua khác.
      const secondBuyer = (await createUser(prisma, TAG)).id;
      const second = await chat.openConversation(secondBuyer, first.shopId);
      const firstId = randomUUID();
      await send(first.shop, first.conversationId, 'tin đầu', firstId);
      for (let i = 1; i < CHAT_SEND_RATE_LIMIT; i++) {
        // Chia tin giữa hai hội thoại: trần tính trên TẤT CẢ hội thoại của người gửi.
        await send(
          first.shop,
          i % 2 ? first.conversationId : second.id,
          `tin ${i}`,
        );
      }

      await expectAppException(send(first.shop, second.id, 'vượt'), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
      await expect(
        send(first.shop, first.conversationId, 'tin đầu', firstId),
      ).resolves.toMatchObject({ replayed: true });
      // Người gửi khác (người mua) không bị ảnh hưởng bởi trần của chủ shop.
      await expect(
        send(first.buyer, first.conversationId, 'mình là người mua'),
      ).resolves.toBeDefined();
    });
  });

  describe('trần tin liên tiếp chưa được trả lời (đếm bằng DB)', () => {
    it(`người mua gửi ${CHAT_MAX_UNANSWERED_MESSAGES} tin khi shop chưa trả lời ⇒ tin tiếp theo bị 429 CHAT_AWAITING_REPLY; shop trả lời ⇒ gửi lại được`, async () => {
      const { buyer, shop, conversationId } = await newConversation();
      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES; i++) {
        await send(buyer, conversationId, `tin ${i}`);
      }

      await expectAppException(send(buyer, conversationId, 'thêm nữa'), {
        status: 429,
        code: 'CHAT_AWAITING_REPLY',
      });
      expect(await messagesOf(conversationId)).toHaveLength(
        CHAT_MAX_UNANSWERED_MESSAGES,
      );

      await send(shop, conversationId, 'shop đã trả lời');
      await expect(
        send(buyer, conversationId, 'cảm ơn shop'),
      ).resolves.toBeDefined();
    });

    it('chỉ tính trong ĐÚNG hội thoại đó: bị chặn ở shop A nhưng vẫn nhắn được cho shop B', async () => {
      const a = await newConversation();
      const ownerB = (await createUser(prisma, TAG)).id;
      const shopB = await makeShop(ownerB);
      const b = await chat.openConversation(a.buyerId, shopB);
      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES; i++) {
        await send(a.buyer, a.conversationId, `tin ${i}`);
      }

      await expectAppException(send(a.buyer, a.conversationId, 'thêm'), {
        status: 429,
        code: 'CHAT_AWAITING_REPLY',
      });
      await expect(send(a.buyer, b.id, 'chào shop B')).resolves.toBeDefined();
    });

    it('chủ shop không bị trần này: trả lời bao nhiêu tin liên tiếp cũng được (trong giới hạn tốc độ)', async () => {
      const { shop, conversationId } = await newConversation();

      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES + 5; i++) {
        await send(shop, conversationId, `trả lời ${i}`);
      }

      expect(await messagesOf(conversationId)).toHaveLength(
        CHAT_MAX_UNANSWERED_MESSAGES + 5,
      );
    });

    it('một instance MỚI dùng chung DB vẫn thấy trần (không giữ trạng thái trong bộ nhớ)', async () => {
      const { buyer, conversationId } = await newConversation();
      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES; i++) {
        await send(buyer, conversationId, `tin ${i}`);
      }
      const second = await buildModule();

      try {
        await expectAppException(
          send(
            buyer,
            conversationId,
            'từ instance khác',
            randomUUID(),
            second.built.get(ChatService),
          ),
          { status: 429, code: 'CHAT_AWAITING_REPLY' },
        );
      } finally {
        await second.built.close();
      }
    });
  });

  describe('đẩy real-time', () => {
    it('đẩy tới CẢ HAI phía đúng sự kiện, đúng vai người nhận; chỉ bản của người gửi có clientMessageId', async () => {
      const { buyer, buyerId, ownerId, shopId, conversationId } =
        await newConversation();
      const clientMessageId = randomUUID();

      const { message } = await send(
        buyer,
        conversationId,
        'xin chào',
        clientMessageId,
      );

      expect(realtime.emitted).toHaveLength(2);
      const byUser = new Map(realtime.emitted.map((e) => [e.userId, e]));
      expect([...byUser.keys()].sort()).toEqual([buyerId, ownerId].sort());
      const buyerCopy = chatMessageEventSchema.parse(
        byUser.get(buyerId)?.payload,
      );
      const shopCopy = chatMessageEventSchema.parse(
        byUser.get(ownerId)?.payload,
      );
      expect(buyerCopy).toMatchObject({ viewerRole: 'BUYER', shopId });
      expect(shopCopy).toMatchObject({ viewerRole: 'SHOP', shopId });
      expect(buyerCopy.message).toMatchObject({
        id: message.id,
        clientMessageId,
      });
      expect(shopCopy.message.id).toBe(message.id);
      expect(shopCopy.message.clientMessageId).toBeUndefined();
      expect(realtime.emitted.every((e) => e.event === 'chat:message')).toBe(
        true,
      );
    });

    it('đẩy LỖI không làm hỏng việc gửi: tin vẫn nằm trong DB', async () => {
      const { buyer, conversationId } = await newConversation();
      realtime.failWith(new Error('socket down'));

      const result = await send(buyer, conversationId, 'vẫn lưu được');

      expect(result.replayed).toBe(false);
      expect(await messagesOf(conversationId)).toHaveLength(1);
    });
  });
});
