import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, ShopStatus } from '@prisma/client';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { CHAT_NEW_CONVERSATIONS_LIMIT } from './chat-config';
import { ChatModule } from './chat.module';
import { ChatService } from './chat.service';

// Integration test trên Postgres THẬT cho "mở hội thoại" (Week10.md 4.3): chứng minh điều unit test với Prisma
// giả không chứng minh được — đua đồng thời chỉ ra MỘT hàng nhờ @@unique + đọc lại P2002, trần hội thoại mới
// được đếm bằng truy vấn nên đúng cả với một "instance" khác dùng chung DB (không giữ trạng thái trong bộ nhớ).
// Chạy: `pnpm test:int`.
const TAG = 'it-chat-open-';

describe('Mở hội thoại chat (DB thật)', () => {
  const prisma = new PrismaClient();
  let moduleFixture: TestingModule;
  let chat: ChatService;
  let ownerId: string;
  let shopIds: string[] = [];
  let counter = 0;

  const makeShop = async (status: ShopStatus = ShopStatus.APPROVED) =>
    (
      await prisma.shop.create({
        data: {
          ownerId,
          name: `${TAG}shop`,
          slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
          status,
        },
        select: { id: true },
      })
    ).id;
  const newBuyer = async () => (await createUser(prisma, TAG)).id;
  const rowsOf = (buyerId: string) =>
    prisma.conversation.findMany({ where: { buyerId } });

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    moduleFixture = await Test.createTestingModule({
      imports: [PrismaModule, ChatModule],
    }).compile();
    chat = moduleFixture.get(ChatService);
    ownerId = (await createUser(prisma, TAG)).id;
    // Đủ shop để thử vượt trần: mỗi hội thoại là một cặp (người mua, shop) khác nhau.
    shopIds = [];
    for (let i = 0; i < CHAT_NEW_CONVERSATIONS_LIMIT + 2; i++) {
      shopIds.push(await makeShop());
    }
  });

  afterAll(async () => {
    await moduleFixture.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('idempotent và an toàn khi đua', () => {
    it('lần đầu tạo đúng một hàng; mở lại trả cùng hội thoại', async () => {
      const buyerId = await newBuyer();

      const first = await chat.openConversation(buyerId, shopIds[0]);
      const second = await chat.openConversation(buyerId, shopIds[0]);

      expect(second.id).toBe(first.id);
      expect(await rowsOf(buyerId)).toHaveLength(1);
      expect(first).toMatchObject({
        shopId: shopIds[0],
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
        isReadOnly: false,
        counterpart: { name: `${TAG}shop`, logoUrl: null },
      });
    });

    it('10 request ĐỒNG THỜI cùng (người mua, shop) ⇒ đúng 1 hàng và cả 10 nhận cùng một hội thoại', async () => {
      const buyerId = await newBuyer();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          chat.openConversation(buyerId, shopIds[0]),
        ),
      );

      const failed = results.filter((r) => r.status === 'rejected');
      expect(failed).toEqual([]);
      const ids = results.map((r) =>
        r.status === 'fulfilled' ? r.value.id : null,
      );
      expect(new Set(ids).size).toBe(1);
      expect(await rowsOf(buyerId)).toHaveLength(1);
    });

    it('hai người mua khác nhau mở cùng một shop ⇒ hai hội thoại riêng', async () => {
      const [a, b] = [await newBuyer(), await newBuyer()];

      const [first, second] = await Promise.all([
        chat.openConversation(a, shopIds[1]),
        chat.openConversation(b, shopIds[1]),
      ]);

      expect(first.id).not.toBe(second.id);
      expect(await rowsOf(a)).toHaveLength(1);
      expect(await rowsOf(b)).toHaveLength(1);
    });

    it('một người mua mở nhiều shop ⇒ mỗi shop một hội thoại', async () => {
      const buyerId = await newBuyer();

      await chat.openConversation(buyerId, shopIds[0]);
      await chat.openConversation(buyerId, shopIds[1]);
      await chat.openConversation(buyerId, shopIds[2]);

      expect(await rowsOf(buyerId)).toHaveLength(3);
    });
  });

  describe('điều kiện về shop', () => {
    it('chủ shop mở hội thoại với shop của chính mình ⇒ 409 CHAT_OWN_SHOP, không có hàng nào', async () => {
      await expectAppException(chat.openConversation(ownerId, shopIds[0]), {
        status: 409,
        code: 'CHAT_OWN_SHOP',
      });

      expect(await rowsOf(ownerId)).toHaveLength(0);
    });

    it.each([ShopStatus.PENDING, ShopStatus.REJECTED, ShopStatus.SUSPENDED])(
      'shop %s ⇒ 404, không tạo hàng',
      async (status) => {
        const buyerId = await newBuyer();
        const shopId = await makeShop(status);

        await expect(
          chat.openConversation(buyerId, shopId),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(await rowsOf(buyerId)).toHaveLength(0);
      },
    );

    it('shop không tồn tại hoặc id sai định dạng ⇒ 404', async () => {
      const buyerId = await newBuyer();

      await expect(
        chat.openConversation(buyerId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        chat.openConversation(buyerId, 'khong-phai-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shop BỊ KHOÁ SAU KHI đã có hội thoại ⇒ mở lại cũng 404 (hội thoại cũ chỉ đọc qua danh sách, không qua "mở")', async () => {
      const buyerId = await newBuyer();
      const shopId = await makeShop();
      await chat.openConversation(buyerId, shopId);

      await prisma.shop.update({
        where: { id: shopId },
        data: { status: ShopStatus.SUSPENDED },
      });

      await expect(
        chat.openConversation(buyerId, shopId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await rowsOf(buyerId)).toHaveLength(1);
    });
  });

  describe('trần hội thoại MỚI trong 24 giờ', () => {
    // Dựng sẵn `count` hội thoại cho người mua bằng cách ghi thẳng DB (nhanh hơn gọi service từng lần).
    const seedConversations = async (
      buyerId: string,
      count: number,
      createdAt?: Date,
    ) => {
      for (let i = 0; i < count; i++) {
        await prisma.conversation.create({
          data: {
            buyerId,
            shopId: shopIds[i],
            ...(createdAt ? { createdAt } : {}),
          },
        });
      }
    };

    it(`đã mở ${CHAT_NEW_CONVERSATIONS_LIMIT} hội thoại mới ⇒ hội thoại thứ ${CHAT_NEW_CONVERSATIONS_LIMIT + 1} bị 429 CHAT_CONVERSATION_LIMIT`, async () => {
      const buyerId = await newBuyer();
      await seedConversations(buyerId, CHAT_NEW_CONVERSATIONS_LIMIT);

      await expectAppException(
        chat.openConversation(buyerId, shopIds[CHAT_NEW_CONVERSATIONS_LIMIT]),
        { status: 429, code: 'CHAT_CONVERSATION_LIMIT' },
      );

      expect(await rowsOf(buyerId)).toHaveLength(CHAT_NEW_CONVERSATIONS_LIMIT);
    });

    it(`mới ${CHAT_NEW_CONVERSATIONS_LIMIT - 1} hội thoại ⇒ vẫn mở thêm được hội thoại cuối cùng`, async () => {
      const buyerId = await newBuyer();
      await seedConversations(buyerId, CHAT_NEW_CONVERSATIONS_LIMIT - 1);

      await expect(
        chat.openConversation(
          buyerId,
          shopIds[CHAT_NEW_CONVERSATIONS_LIMIT - 1],
        ),
      ).resolves.toBeDefined();
    });

    it('MỞ LẠI hội thoại đã có không tính và không bị chặn dù đã chạm trần', async () => {
      const buyerId = await newBuyer();
      await seedConversations(buyerId, CHAT_NEW_CONVERSATIONS_LIMIT);

      await expect(
        chat.openConversation(buyerId, shopIds[0]),
      ).resolves.toMatchObject({ shopId: shopIds[0] });
    });

    it('hội thoại tạo CÁCH ĐÂY HƠN 24 giờ đã ra khỏi cửa sổ: không bị tính', async () => {
      const buyerId = await newBuyer();
      const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await seedConversations(buyerId, CHAT_NEW_CONVERSATIONS_LIMIT, longAgo);

      await expect(
        chat.openConversation(buyerId, shopIds[CHAT_NEW_CONVERSATIONS_LIMIT]),
      ).resolves.toBeDefined();
    });

    it('trần tính riêng từng người mua: người khác đã chạm trần không ảnh hưởng người mua bình thường', async () => {
      const spammer = await newBuyer();
      await seedConversations(spammer, CHAT_NEW_CONVERSATIONS_LIMIT);
      const honest = await newBuyer();

      await expect(
        chat.openConversation(honest, shopIds[0]),
      ).resolves.toBeDefined();
    });

    it('đúng sau "khởi động lại": một instance MỚI dùng chung DB vẫn thấy trần (không giữ trạng thái trong bộ nhớ)', async () => {
      const buyerId = await newBuyer();
      await seedConversations(buyerId, CHAT_NEW_CONVERSATIONS_LIMIT);
      const secondInstance = await Test.createTestingModule({
        imports: [PrismaModule, ChatModule],
      }).compile();

      try {
        await expectAppException(
          secondInstance
            .get(ChatService)
            .openConversation(buyerId, shopIds[CHAT_NEW_CONVERSATIONS_LIMIT]),
          { status: 429, code: 'CHAT_CONVERSATION_LIMIT' },
        );
      } finally {
        await secondInstance.close();
      }
    });
  });

  describe('hội thoại đã có tin nhắn', () => {
    it('trả tin cuối rút gọn, vai người gửi và số chưa đọc theo mốc đã đọc của người mua', async () => {
      const buyerId = await newBuyer();
      const shopId = await makeShop();
      const conversation = await prisma.conversation.create({
        data: { buyerId, shopId },
      });
      const t = (minutes: number) =>
        new Date(Date.UTC(2030, 0, 1, 10, minutes, 0));
      // 1 tin của người mua (đã đọc), 2 tin của shop SAU mốc đã đọc của người mua, 1 tin của shop TRƯỚC mốc.
      await prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            senderId: buyerId,
            content: 'chào shop',
            createdAt: t(0),
          },
          {
            conversationId: conversation.id,
            senderId: ownerId,
            content: 'chào bạn (đã đọc)',
            createdAt: t(1),
          },
          {
            conversationId: conversation.id,
            senderId: ownerId,
            content: 'còn hàng',
            createdAt: t(5),
          },
          {
            conversationId: conversation.id,
            senderId: ownerId,
            content: `dòng một\ndòng hai ${'z'.repeat(300)}`,
            createdAt: t(6),
          },
        ],
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: t(6), buyerLastReadAt: t(2) },
      });

      const result = await chat.openConversation(buyerId, shopId);

      expect(result.id).toBe(conversation.id);
      expect(result.unreadCount).toBe(2);
      expect(result.lastMessageAt).toBe(t(6).toISOString());
      expect(result.lastMessage?.senderRole).toBe('SHOP');
      expect(result.lastMessage?.createdAt).toBe(t(6).toISOString());
      expect(result.lastMessage?.content.startsWith('dòng một dòng hai ')).toBe(
        true,
      );
      expect(Array.from(result.lastMessage?.content ?? '')).toHaveLength(100);
    });

    it('tin của CHÍNH người mua không bao giờ tính là chưa đọc', async () => {
      const buyerId = await newBuyer();
      const shopId = await makeShop();
      const conversation = await prisma.conversation.create({
        data: { buyerId, shopId },
      });
      await prisma.message.createMany({
        data: [1, 2, 3].map((n) => ({
          conversationId: conversation.id,
          senderId: buyerId,
          content: `tin ${n}`,
          createdAt: new Date(Date.UTC(2030, 0, 1, 10, n, 0)),
        })),
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(Date.UTC(2030, 0, 1, 10, 3, 0)) },
      });

      const result = await chat.openConversation(buyerId, shopId);

      expect(result.unreadCount).toBe(0);
      expect(result.lastMessage?.senderRole).toBe('BUYER');
    });
  });
});
