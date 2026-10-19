import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient, ShopStatus } from '@prisma/client';
import { chatReadPayloadSchema } from '@ecommerce/types';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import { encodeChatCursor } from './chat-cursor';
import { buildDigestQuery, buildUnreadCountQuery } from './chat-queries';
import { ChatModule } from './chat.module';
import { ChatService, type ChatActor } from './chat.service';

// Integration test trên Postgres THẬT cho phần ĐỌC của chat (Week10.md 4.5). Unit test với Prisma giả không chứng
// minh được hai thứ quan trọng nhất ở đây: câu SQL nhóm (tin cuối + chưa đọc của cả trang, đếm chưa đọc) cho ra
// đúng số, và con trỏ (createdAt, id) không trùng/mất dòng khi nhiều dòng cùng mili-giây. Tin được chèn thẳng
// với `createdAt` tự chọn để kiểm soát thứ tự và các ca hoà — gửi qua service thì thời điểm do Prisma đóng dấu lúc gửi, không
// dựng được ca hoà. Real-time dùng bản giả. Chạy: `pnpm test:int`.
const TAG = 'it-chat-read-';
const BASE = Date.now() - 6 * 60 * 60 * 1000;
const at = (seconds: number) => new Date(BASE + seconds * 1000);

interface Side {
  ownerId: string;
  shopId: string;
  shop: ChatActor;
}

describe('Đọc chat (DB thật)', () => {
  const prisma = new PrismaClient();
  let moduleFixture: TestingModule;
  let chat: ChatService;
  let realtime: FakeRealtimeEmitter;
  let counter = 0;

  const newBuyer = async () => (await createUser(prisma, TAG)).id;
  const newShop = async (
    status: ShopStatus = ShopStatus.APPROVED,
    ownerId?: string,
  ): Promise<Side> => {
    const owner = ownerId ?? (await createUser(prisma, TAG)).id;
    const { id } = await prisma.shop.create({
      data: {
        ownerId: owner,
        name: `${TAG}shop-${counter}`,
        slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
        status,
        logoUrl: 'https://img.test/logo.png',
      },
      select: { id: true },
    });
    return {
      ownerId: owner,
      shopId: id,
      shop: { kind: 'SHOP', userId: owner, shopId: id },
    };
  };
  const buyerActor = (userId: string): ChatActor => ({ kind: 'BUYER', userId });
  const open = async (buyerId: string, shopId: string) =>
    (await chat.openConversation(buyerId, shopId)).id;

  // Chèn một tin với createdAt tự chọn và nâng lastMessageAt như sendMessage (không đụng mốc đã đọc).
  const insert = async (
    conversationId: string,
    senderId: string,
    when: Date,
    content = 'xin chào',
  ) => {
    const { id } = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        createdAt: when,
        clientMessageId: randomUUID(),
      },
      select: { id: true },
    });
    await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: when } }],
      },
      data: { lastMessageAt: when },
    });
    return id;
  };
  const setMarks = (
    conversationId: string,
    marks: { buyer?: Date | null; shop?: Date | null },
  ) =>
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(marks.buyer !== undefined && { buyerLastReadAt: marks.buyer }),
        ...(marks.shop !== undefined && { shopLastReadAt: marks.shop }),
      },
    });
  const conversationOf = (id: string) =>
    prisma.conversation.findUniqueOrThrow({ where: { id } });

  const listAll = async (
    actor: ChatActor,
    limit: number,
  ): Promise<{ ids: string[]; pages: number }> => {
    const ids: string[] = [];
    let before: string | undefined;
    let pages = 0;
    do {
      const page = await chat.listConversations(actor, { limit, before });
      ids.push(...page.items.map((i) => i.id));
      before = page.nextCursor ?? undefined;
      pages++;
    } while (before && pages < 100);
    return { ids, pages };
  };
  const messagesAll = async (
    actor: ChatActor,
    conversationId: string,
    limit: number,
  ): Promise<{ ids: string[]; pages: number }> => {
    const ids: string[] = [];
    let before: string | undefined;
    let pages = 0;
    do {
      const page = await chat.listMessages(actor, conversationId, {
        limit,
        before,
      });
      ids.push(...page.items.map((m) => m.id));
      before = page.nextCursor ?? undefined;
      pages++;
    } while (before && pages < 500);
    return { ids, pages };
  };

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    realtime = createFakeRealtimeEmitter();
    moduleFixture = await Test.createTestingModule({
      imports: [PrismaModule, ChatModule],
    })
      .overrideProvider(REALTIME_EMITTER)
      .useValue(realtime)
      .compile();
    chat = moduleFixture.get(ChatService);
  });

  beforeEach(() => realtime.reset());

  afterAll(async () => {
    await moduleFixture.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('listConversations', () => {
    it('chỉ liệt kê hội thoại ĐÃ có tin — hội thoại vừa mở, chưa ai nhắn, không hiện ở cả hai phía', async () => {
      const buyerId = await newBuyer();
      const withMessage = await newShop();
      const empty = await newShop();
      const talking = await open(buyerId, withMessage.shopId);
      await open(buyerId, empty.shopId);
      await insert(talking, buyerId, at(1));

      const buyerView = await chat.listConversations(buyerActor(buyerId), {
        limit: 20,
      });
      const emptyShopView = await chat.listConversations(empty.shop, {
        limit: 20,
      });

      expect(buyerView.items.map((i) => i.id)).toEqual([talking]);
      expect(emptyShopView.items).toEqual([]);
    });

    it('mới nhất trước; cùng mili-giây thì id lớn hơn trước', async () => {
      const buyerId = await newBuyer();
      const shops = await Promise.all([newShop(), newShop(), newShop()]);
      const [a, b, c] = await Promise.all(
        shops.map((s) => open(buyerId, s.shopId)),
      );
      await insert(a, buyerId, at(10));
      await insert(b, buyerId, at(30));
      await insert(c, buyerId, at(20));

      const result = await chat.listConversations(buyerActor(buyerId), {
        limit: 20,
      });

      expect(result.items.map((i) => i.id)).toEqual([b, c, a]);
      expect(result.nextCursor).toBeNull();
    });

    it('người mua thấy tên + logo SHOP; chủ shop thấy tên NGƯỜI MUA; không đâu có email', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1), 'còn hàng không ạ');

      const buyerView = await chat.listConversations(buyerActor(buyerId), {
        limit: 20,
      });
      const shopView = await chat.listConversations(side.shop, { limit: 20 });

      expect(buyerView.items[0].counterpart).toEqual({
        name: `${TAG}shop-${counter - 1}`,
        logoUrl: 'https://img.test/logo.png',
      });
      expect(shopView.items[0].counterpart).toEqual({
        name: `${TAG}user`,
        logoUrl: null,
      });
      const everything = JSON.stringify([buyerView, shopView]);
      expect(everything).not.toContain('@test.local');
      expect(everything).not.toContain(side.ownerId);
    });

    describe('tin cuối và số chưa đọc (một truy vấn nhóm)', () => {
      it('đúng cho cả hai phía theo mốc đã đọc riêng của từng bên', async () => {
        const buyerId = await newBuyer();
        const side = await newShop();
        const conversationId = await open(buyerId, side.shopId);
        // B1 B2 S1 S2 S3
        await insert(conversationId, buyerId, at(1), 'b1');
        await insert(conversationId, buyerId, at(2), 'b2');
        await insert(conversationId, side.ownerId, at(3), 's1');
        await insert(conversationId, side.ownerId, at(4), 's2');
        await insert(conversationId, side.ownerId, at(5), 's3');
        await setMarks(conversationId, { buyer: at(2), shop: at(5) });

        const [buyerItem] = (
          await chat.listConversations(buyerActor(buyerId), { limit: 20 })
        ).items;
        const [shopItem] = (
          await chat.listConversations(side.shop, { limit: 20 })
        ).items;

        expect(buyerItem.lastMessage).toEqual({
          content: 's3',
          senderRole: 'SHOP',
          createdAt: at(5).toISOString(),
        });
        expect(buyerItem.lastMessageAt).toBe(at(5).toISOString());
        expect(buyerItem.unreadCount).toBe(3); // s1 s2 s3 sau mốc at(2)
        expect(shopItem.lastMessage?.senderRole).toBe('SHOP');
        expect(shopItem.unreadCount).toBe(0); // shop đã đọc tới at(5), tin của người mua đều trước đó
      });

      it('mốc NULL (chưa đọc lần nào) ⇒ mọi tin của ĐỐI PHƯƠNG đều chưa đọc; tin của chính mình không bao giờ', async () => {
        const buyerId = await newBuyer();
        const side = await newShop();
        const conversationId = await open(buyerId, side.shopId);
        await insert(conversationId, buyerId, at(1));
        await insert(conversationId, buyerId, at(2));
        await insert(conversationId, side.ownerId, at(3));

        const [buyerItem] = (
          await chat.listConversations(buyerActor(buyerId), { limit: 20 })
        ).items;
        const [shopItem] = (
          await chat.listConversations(side.shop, { limit: 20 })
        ).items;

        expect(buyerItem.unreadCount).toBe(1);
        expect(shopItem.unreadCount).toBe(2);
      });

      it('tin đúng bằng mốc đã đọc thì ĐÃ đọc (so sánh nghiêm ngặt >)', async () => {
        const buyerId = await newBuyer();
        const side = await newShop();
        const conversationId = await open(buyerId, side.shopId);
        await insert(conversationId, side.ownerId, at(1));
        await insert(conversationId, side.ownerId, at(2));
        await setMarks(conversationId, { buyer: at(1) });

        const [item] = (
          await chat.listConversations(buyerActor(buyerId), { limit: 20 })
        ).items;

        expect(item.unreadCount).toBe(1);
      });

      it('tin cuối là tin có (createdAt, id) lớn nhất — hai tin cùng mili-giây chọn theo id, ổn định', async () => {
        const buyerId = await newBuyer();
        const side = await newShop();
        const conversationId = await open(buyerId, side.shopId);
        await insert(conversationId, buyerId, at(5), 'cùng thời điểm A');
        await insert(conversationId, side.ownerId, at(5), 'cùng thời điểm B');
        const expected = await prisma.message.findFirstOrThrow({
          where: { conversationId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

        const [item] = (
          await chat.listConversations(buyerActor(buyerId), { limit: 20 })
        ).items;

        expect(item.lastMessage?.content).toBe(expected.content);
      });

      it('tin cuối bị rút gọn về 100 ký tự và gộp xuống dòng', async () => {
        const buyerId = await newBuyer();
        const side = await newShop();
        const conversationId = await open(buyerId, side.shopId);
        await insert(conversationId, buyerId, at(1), `a\nb ${'x'.repeat(500)}`);

        const [item] = (
          await chat.listConversations(buyerActor(buyerId), { limit: 20 })
        ).items;

        expect(Array.from(item.lastMessage?.content ?? '')).toHaveLength(100);
        expect(item.lastMessage?.content.startsWith('a b xxx')).toBe(true);
        expect(item.lastMessage?.content.endsWith('…')).toBe(true);
      });

      it('nhiều hội thoại cùng lúc: mỗi hội thoại nhận đúng số của MÌNH (không lẫn)', async () => {
        const buyerId = await newBuyer();
        const sides = await Promise.all([newShop(), newShop(), newShop()]);
        const ids = await Promise.all(
          sides.map((s) => open(buyerId, s.shopId)),
        );
        // hội thoại i có (i + 1) tin chưa đọc từ shop
        for (const [i, id] of ids.entries()) {
          for (let k = 0; k <= i; k++) {
            await insert(id, sides[i].ownerId, at(100 + i * 10 + k), `c${i}`);
          }
        }

        const { items } = await chat.listConversations(buyerActor(buyerId), {
          limit: 20,
        });

        const byId = new Map(items.map((i) => [i.id, i]));
        ids.forEach((id, i) => {
          expect(byId.get(id)?.unreadCount).toBe(i + 1);
          expect(byId.get(id)?.lastMessage?.content).toBe(`c${i}`);
        });
      });
    });

    describe('cách ly và quyền', () => {
      it('mỗi phía chỉ thấy hội thoại CỦA MÌNH: người mua khác, shop khác không thấy gì của nhau', async () => {
        const buyerA = await newBuyer();
        const buyerB = await newBuyer();
        const shopA = await newShop();
        const shopB = await newShop();
        const cA = await open(buyerA, shopA.shopId);
        const cB = await open(buyerB, shopB.shopId);
        await insert(cA, buyerA, at(1));
        await insert(cB, buyerB, at(2));

        const idsOf = async (actor: ChatActor) =>
          (await chat.listConversations(actor, { limit: 20 })).items.map(
            (i) => i.id,
          );

        expect(await idsOf(buyerActor(buyerA))).toEqual([cA]);
        expect(await idsOf(buyerActor(buyerB))).toEqual([cB]);
        expect(await idsOf(shopA.shop)).toEqual([cA]);
        expect(await idsOf(shopB.shop)).toEqual([cB]);
      });

      it('người vừa là người mua vừa là chủ shop: hộp thư người mua và hộp thư shop tách bạch', async () => {
        const both = await newBuyer();
        const myShop = await newShop(ShopStatus.APPROVED, both);
        const otherShop = await newShop();
        const otherBuyer = await newBuyer();
        const asBuyer = await open(both, otherShop.shopId);
        const asOwner = await open(otherBuyer, myShop.shopId);
        await insert(asBuyer, both, at(1));
        await insert(asOwner, otherBuyer, at(2));

        const buyerBox = await chat.listConversations(buyerActor(both), {
          limit: 20,
        });
        const shopBox = await chat.listConversations(myShop.shop, {
          limit: 20,
        });

        expect(buyerBox.items.map((i) => i.id)).toEqual([asBuyer]);
        expect(shopBox.items.map((i) => i.id)).toEqual([asOwner]);
      });

      it('route shop với shopId của shop KHÁC, hoặc shop không tồn tại ⇒ 404 (kể cả khi mạo userId chủ thật)', async () => {
        const victim = await newShop();
        const attacker = await newBuyer();

        await expect(
          chat.listConversations(
            { kind: 'SHOP', userId: attacker, shopId: victim.shopId },
            { limit: 20 },
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          chat.listConversations(
            { kind: 'SHOP', userId: victim.ownerId, shopId: randomUUID() },
            { limit: 20 },
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('shop bị khoá: người mua vẫn thấy hội thoại (isReadOnly), chủ shop vẫn thấy hộp thư của mình (isReadOnly)', async () => {
        const buyerId = await newBuyer();
        const side = await newShop(ShopStatus.SUSPENDED);
        const conversationId = await prisma.conversation
          .create({
            data: { buyerId, shopId: side.shopId },
            select: { id: true },
          })
          .then((c) => c.id);
        await insert(conversationId, buyerId, at(1));

        const buyerView = await chat.listConversations(buyerActor(buyerId), {
          limit: 20,
        });
        const shopView = await chat.listConversations(side.shop, { limit: 20 });

        expect(buyerView.items[0].isReadOnly).toBe(true);
        expect(shopView.items[0].isReadOnly).toBe(true);
      });
    });

    describe('phân trang theo con trỏ (lastMessageAt, id)', () => {
      it('đi hết mọi trang với nhiều hội thoại CÙNG mili-giây: không trùng, không thiếu, đúng thứ tự', async () => {
        const buyerId = await newBuyer();
        const shops = await Promise.all(
          Array.from({ length: 9 }, () => newShop()),
        );
        const ids = await Promise.all(
          shops.map((s) => open(buyerId, s.shopId)),
        );
        // 9 hội thoại chia vào 3 mốc thời gian ⇒ mỗi mốc có 3 hội thoại hoà nhau.
        for (const [i, id] of ids.entries()) {
          await insert(id, buyerId, at(200 + Math.floor(i / 3)));
        }
        const expected = (
          await prisma.conversation.findMany({
            where: { buyerId },
            orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          })
        ).map((c) => c.id);

        for (const limit of [1, 2, 4, 9, 20]) {
          const walked = await listAll(buyerActor(buyerId), limit);
          expect(walked.ids).toEqual(expected);
          expect(walked.pages).toBe(Math.ceil(9 / limit));
        }
      });

      it('đúng bằng limit dòng ⇒ không có trang rỗng thừa', async () => {
        const buyerId = await newBuyer();
        const shops = await Promise.all([newShop(), newShop()]);
        for (const s of shops) {
          await insert(await open(buyerId, s.shopId), buyerId, at(1));
        }

        const page = await chat.listConversations(buyerActor(buyerId), {
          limit: 2,
        });

        expect(page.items).toHaveLength(2);
        expect(page.nextCursor).toBeNull();
      });

      it('con trỏ xấu ⇒ 400; limit ngoài khoảng ⇒ 400', async () => {
        const buyerId = await newBuyer();

        await expect(
          chat.listConversations(buyerActor(buyerId), {
            limit: 20,
            before: 'khong-hop-le!',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          chat.listConversations(buyerActor(buyerId), { limit: 51 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });

  describe('listMessages', () => {
    it('phân trang 120 tin chỉ có 8 mốc thời gian (nhiều tin hoà nhau): không trùng, không thiếu, đúng thứ tự — với mọi cỡ trang', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await prisma.message.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          conversationId,
          senderId: i % 2 ? buyerId : side.ownerId,
          content: `tin ${i}`,
          createdAt: at(300 + (i % 8)),
        })),
      });
      const expected = (
        await prisma.message.findMany({
          where: { conversationId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map((m) => m.id);

      for (const limit of [50, 30, 7, 1]) {
        const walked = await messagesAll(
          buyerActor(buyerId),
          conversationId,
          limit,
        );
        expect(walked.ids).toEqual(expected);
        expect(walked.pages).toBe(Math.ceil(120 / limit));
      }
    });

    it('25 tin CÙNG một mili-giây, đi từng tin một: khoá phụ id giữ thứ tự và không mất tin nào', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await prisma.message.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          conversationId,
          senderId: buyerId,
          content: `cùng lúc ${i}`,
          createdAt: at(400),
        })),
      });
      const expected = (
        await prisma.message.findMany({
          where: { conversationId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map((m) => m.id);

      const walked = await messagesAll(buyerActor(buyerId), conversationId, 1);

      expect(walked.ids).toEqual(expected);
      expect(new Set(walked.ids).size).toBe(25);
    });

    it('trang đầu là tin MỚI NHẤT, theo thứ tự giảm dần; vai người gửi đúng', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1), 'cũ nhất');
      await insert(conversationId, side.ownerId, at(2), 'giữa');
      await insert(conversationId, buyerId, at(3), 'mới nhất');

      const page = await chat.listMessages(
        buyerActor(buyerId),
        conversationId,
        {
          limit: 30,
        },
      );

      expect(page.items.map((m) => [m.content, m.senderRole])).toEqual([
        ['mới nhất', 'BUYER'],
        ['giữa', 'SHOP'],
        ['cũ nhất', 'BUYER'],
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it('clientMessageId chỉ có trên tin của CHÍNH người xem; người kia không thấy', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      const mine = await chat.sendMessage(buyerActor(buyerId), conversationId, {
        content: 'của người mua',
        clientMessageId: randomUUID(),
      });
      const theirs = await chat.sendMessage(side.shop, conversationId, {
        content: 'của shop',
        clientMessageId: randomUUID(),
      });

      const asBuyer = await chat.listMessages(
        buyerActor(buyerId),
        conversationId,
        {
          limit: 30,
        },
      );
      const asShop = await chat.listMessages(side.shop, conversationId, {
        limit: 30,
      });

      const find = (list: typeof asBuyer, id: string) =>
        list.items.find((m) => m.id === id);
      expect(find(asBuyer, mine.message.id)?.clientMessageId).toBe(
        mine.message.clientMessageId,
      );
      expect(find(asBuyer, theirs.message.id)?.clientMessageId).toBeUndefined();
      expect(find(asShop, theirs.message.id)?.clientMessageId).toBe(
        theirs.message.clientMessageId,
      );
      expect(find(asShop, mine.message.id)?.clientMessageId).toBeUndefined();
    });

    it('không phải thành viên ⇒ 404, mọi kiểu: người mua khác, chủ shop khác, mạo shopId, nhầm route, không tồn tại', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1), 'bí mật');
      const stranger = await newBuyer();
      const otherShop = await newShop();

      const attempts: ChatActor[] = [
        buyerActor(stranger),
        otherShop.shop,
        { kind: 'SHOP', userId: otherShop.ownerId, shopId: side.shopId },
        { kind: 'SHOP', userId: side.ownerId, shopId: otherShop.shopId },
        buyerActor(side.ownerId),
        { kind: 'SHOP', userId: buyerId, shopId: side.shopId },
      ];
      const outcomes = await Promise.allSettled([
        ...attempts.map((a) =>
          chat.listMessages(a, conversationId, { limit: 30 }),
        ),
        chat.listMessages(buyerActor(buyerId), randomUUID(), { limit: 30 }),
        chat.listMessages(buyerActor(buyerId), 'khong-phai-uuid', {
          limit: 30,
        }),
      ]);

      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        expect(
          outcome.status === 'rejected' ? outcome.reason : null,
        ).toBeInstanceOf(NotFoundException);
      }
    });

    it('shop bị khoá: cả hai phía vẫn ĐỌC được lịch sử', async () => {
      const buyerId = await newBuyer();
      const side = await newShop(ShopStatus.SUSPENDED);
      const conversationId = (
        await prisma.conversation.create({
          data: { buyerId, shopId: side.shopId },
          select: { id: true },
        })
      ).id;
      await insert(conversationId, buyerId, at(1), 'trước khi bị khoá');

      const asBuyer = await chat.listMessages(
        buyerActor(buyerId),
        conversationId,
        {
          limit: 30,
        },
      );
      const asShop = await chat.listMessages(side.shop, conversationId, {
        limit: 30,
      });

      expect(asBuyer.items).toHaveLength(1);
      expect(asShop.items).toHaveLength(1);
    });

    it('con trỏ hợp lệ nhưng ở tương lai xa ⇒ trả toàn bộ; ở quá khứ xa ⇒ trả rỗng', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1));
      await insert(conversationId, buyerId, at(2));
      const cursorAt = (when: Date) =>
        encodeChatCursor({ at: when, id: randomUUID() });

      const future = await chat.listMessages(
        buyerActor(buyerId),
        conversationId,
        {
          limit: 30,
          before: cursorAt(new Date('2099-01-01T00:00:00.000Z')),
        },
      );
      const past = await chat.listMessages(
        buyerActor(buyerId),
        conversationId,
        {
          limit: 30,
          before: cursorAt(new Date('2000-01-01T00:00:00.000Z')),
        },
      );

      expect(future.items).toHaveLength(2);
      expect(past.items).toEqual([]);
      expect(past.nextCursor).toBeNull();
    });
  });

  describe('markRead', () => {
    const setup = async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1), 'b1');
      await insert(conversationId, side.ownerId, at(2), 's1');
      await insert(conversationId, side.ownerId, at(3), 's2');
      return { buyerId, side, conversationId };
    };

    it('người mua đánh dấu: mốc = tin mới nhất, số chưa đọc về 0, chỉ chủ shop nhận chat:read', async () => {
      const { buyerId, side, conversationId } = await setup();

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(result).toEqual({ readAt: at(3).toISOString() });
      expect((await conversationOf(conversationId)).buyerLastReadAt).toEqual(
        at(3),
      );
      expect(
        (await chat.listConversations(buyerActor(buyerId), { limit: 20 }))
          .items[0].unreadCount,
      ).toBe(0);
      expect(realtime.emitted).toHaveLength(1);
      expect(realtime.emitted[0].userId).toBe(side.ownerId);
      expect(realtime.emitted[0].event).toBe('chat:read');
      expect(chatReadPayloadSchema.parse(realtime.emitted[0].payload)).toEqual({
        conversationId,
        readAt: at(3).toISOString(),
      });
    });

    it('chủ shop đánh dấu: chỉ mốc của SHOP đổi, mốc người mua giữ nguyên, chỉ người mua nhận sự kiện', async () => {
      const { buyerId, side, conversationId } = await setup();
      await setMarks(conversationId, { buyer: at(1) });

      await chat.markRead(side.shop, conversationId);

      const row = await conversationOf(conversationId);
      expect(row.shopLastReadAt).toEqual(at(3));
      expect(row.buyerLastReadAt).toEqual(at(1));
      expect(realtime.emitted.map((e) => e.userId)).toEqual([buyerId]);
    });

    it('gọi lại ⇒ idempotent: mốc không đổi, KHÔNG đẩy thêm sự kiện', async () => {
      const { buyerId, conversationId } = await setup();
      await chat.markRead(buyerActor(buyerId), conversationId);
      realtime.reset();

      const again = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(again).toEqual({ readAt: at(3).toISOString() });
      expect(realtime.emitted).toEqual([]);
    });

    it('KHÔNG BAO GIỜ lùi: mốc đã ở xa hơn thì giữ nguyên, trả mốc đó, không đẩy sự kiện', async () => {
      const { buyerId, conversationId } = await setup();
      const ahead = at(999);
      await setMarks(conversationId, { buyer: ahead });

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(result).toEqual({ readAt: ahead.toISOString() });
      expect((await conversationOf(conversationId)).buyerLastReadAt).toEqual(
        ahead,
      );
      expect(realtime.emitted).toEqual([]);
    });

    it('10 lần đánh dấu ĐỒNG THỜI: mốc cuối đúng, và đúng MỘT sự kiện (UPDATE có điều kiện chỉ thắng một lần)', async () => {
      const { buyerId, conversationId } = await setup();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          chat.markRead(buyerActor(buyerId), conversationId),
        ),
      );

      expect(new Set(results.map((r) => r.readAt))).toEqual(
        new Set([at(3).toISOString()]),
      );
      expect((await conversationOf(conversationId)).buyerLastReadAt).toEqual(
        at(3),
      );
      expect(realtime.emitted).toHaveLength(1);
    });

    it('tin đến SAU khi đánh dấu vẫn chưa đọc (mốc không "ăn" tin tương lai)', async () => {
      const { buyerId, side, conversationId } = await setup();
      await chat.markRead(buyerActor(buyerId), conversationId);

      await insert(conversationId, side.ownerId, at(4), 'tin mới');

      const [item] = (
        await chat.listConversations(buyerActor(buyerId), { limit: 20 })
      ).items;
      expect(item.unreadCount).toBe(1);
      expect(item.lastMessage?.content).toBe('tin mới');
    });

    it('đánh dấu lần nữa sau tin mới ⇒ mốc nhích lên và có sự kiện mới', async () => {
      const { buyerId, side, conversationId } = await setup();
      await chat.markRead(buyerActor(buyerId), conversationId);
      await insert(conversationId, side.ownerId, at(4));
      realtime.reset();

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(result.readAt).toBe(at(4).toISOString());
      expect(realtime.emitted).toHaveLength(1);
    });

    it('hội thoại chưa có tin: không ghi, không đẩy sự kiện (đối phương chưa thấy nó tồn tại)', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      const row = await conversationOf(conversationId);
      expect(row.buyerLastReadAt).toBeNull();
      expect(result.readAt).toBe(row.createdAt.toISOString());
      expect(realtime.emitted).toEqual([]);
    });

    it('không phải thành viên ⇒ 404, dữ liệu và sự kiện không đổi', async () => {
      const { buyerId, side, conversationId } = await setup();
      const stranger = await newBuyer();
      const otherShop = await newShop();
      const before = await conversationOf(conversationId);

      const outcomes = await Promise.allSettled([
        chat.markRead(buyerActor(stranger), conversationId),
        chat.markRead(otherShop.shop, conversationId),
        chat.markRead(
          { kind: 'SHOP', userId: otherShop.ownerId, shopId: side.shopId },
          conversationId,
        ),
        chat.markRead(buyerActor(side.ownerId), conversationId),
        chat.markRead(
          { kind: 'SHOP', userId: buyerId, shopId: side.shopId },
          conversationId,
        ),
        chat.markRead(buyerActor(buyerId), randomUUID()),
      ]);

      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        expect(
          outcome.status === 'rejected' ? outcome.reason : null,
        ).toBeInstanceOf(NotFoundException);
      }
      expect(await conversationOf(conversationId)).toEqual(before);
      expect(realtime.emitted).toEqual([]);
    });

    it('lỗi đẩy real-time không làm mất việc đánh dấu', async () => {
      const { buyerId, conversationId } = await setup();
      realtime.failWith(new Error('socket down'));

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(result.readAt).toBe(at(3).toISOString());
      expect((await conversationOf(conversationId)).buyerLastReadAt).toEqual(
        at(3),
      );
    });

    it('shop bị khoá vẫn đánh dấu đã đọc được (đọc không phải gửi)', async () => {
      const buyerId = await newBuyer();
      const side = await newShop(ShopStatus.SUSPENDED);
      const conversationId = (
        await prisma.conversation.create({
          data: { buyerId, shopId: side.shopId },
          select: { id: true },
        })
      ).id;
      await insert(conversationId, side.ownerId, at(1));

      const result = await chat.markRead(buyerActor(buyerId), conversationId);

      expect(result.readAt).toBe(at(1).toISOString());
    });
  });

  describe('unreadCount (huy hiệu)', () => {
    it('người mua: cộng chưa đọc trên MỌI hội thoại của mình, không tính tin của chính mình, khớp tổng ở danh sách', async () => {
      const buyerId = await newBuyer();
      const [a, b] = await Promise.all([newShop(), newShop()]);
      const cA = await open(buyerId, a.shopId);
      const cB = await open(buyerId, b.shopId);
      await insert(cA, a.ownerId, at(1));
      await insert(cA, a.ownerId, at(2));
      await insert(cA, buyerId, at(3)); // của chính mình
      await insert(cB, b.ownerId, at(4));
      await insert(cB, b.ownerId, at(5));
      await insert(cB, b.ownerId, at(6));
      await setMarks(cA, { buyer: at(1) });

      const { unreadCount } = await chat.unreadCount(buyerActor(buyerId));
      const list = await chat.listConversations(buyerActor(buyerId), {
        limit: 20,
      });

      // cA: chỉ tin at(2) (sau mốc at(1), của shop); cB: 3 tin, mốc NULL
      expect(unreadCount).toBe(4);
      expect(list.items.reduce((sum, i) => sum + i.unreadCount, 0)).toBe(4);
    });

    it('chủ shop: chỉ tin của NGƯỜI MUA trong shop MÌNH, không lẫn shop khác', async () => {
      const buyerId = await newBuyer();
      const mine = await newShop();
      const other = await newShop();
      const cMine = await open(buyerId, mine.shopId);
      const cOther = await open(buyerId, other.shopId);
      await insert(cMine, buyerId, at(1));
      await insert(cMine, buyerId, at(2));
      await insert(cMine, mine.ownerId, at(3));
      await insert(cOther, buyerId, at(4));
      await setMarks(cMine, { shop: at(1) });

      const result = await chat.unreadCount(mine.shop);

      expect(result).toEqual({ unreadCount: 1 }); // chỉ tin at(2)
      expect(await chat.unreadCount(other.shop)).toEqual({ unreadCount: 1 });
    });

    it('người vừa là người mua vừa là chủ shop có HAI con số độc lập', async () => {
      const both = await newBuyer();
      const myShop = await newShop(ShopStatus.APPROVED, both);
      const otherShop = await newShop();
      const otherBuyer = await newBuyer();
      const asBuyer = await open(both, otherShop.shopId);
      const asOwner = await open(otherBuyer, myShop.shopId);
      await insert(asBuyer, otherShop.ownerId, at(1));
      await insert(asOwner, otherBuyer, at(2));
      await insert(asOwner, otherBuyer, at(3));

      expect(await chat.unreadCount(buyerActor(both))).toEqual({
        unreadCount: 1,
      });
      expect(await chat.unreadCount(myShop.shop)).toEqual({ unreadCount: 2 });
    });

    it('đánh dấu đã đọc một hội thoại ⇒ huy hiệu giảm đúng phần của hội thoại đó', async () => {
      const buyerId = await newBuyer();
      const [a, b] = await Promise.all([newShop(), newShop()]);
      const cA = await open(buyerId, a.shopId);
      const cB = await open(buyerId, b.shopId);
      await insert(cA, a.ownerId, at(1));
      await insert(cA, a.ownerId, at(2));
      await insert(cB, b.ownerId, at(3));
      expect(await chat.unreadCount(buyerActor(buyerId))).toEqual({
        unreadCount: 3,
      });

      await chat.markRead(buyerActor(buyerId), cA);

      expect(await chat.unreadCount(buyerActor(buyerId))).toEqual({
        unreadCount: 1,
      });
    });

    it('không có hội thoại nào ⇒ 0; shop bị khoá vẫn đếm được; shop của người khác ⇒ 404', async () => {
      const lonely = await newBuyer();
      const suspended = await newShop(ShopStatus.SUSPENDED);
      const buyerId = await newBuyer();
      const conversationId = (
        await prisma.conversation.create({
          data: { buyerId, shopId: suspended.shopId },
          select: { id: true },
        })
      ).id;
      await insert(conversationId, buyerId, at(1));

      expect(await chat.unreadCount(buyerActor(lonely))).toEqual({
        unreadCount: 0,
      });
      expect(await chat.unreadCount(suspended.shop)).toEqual({
        unreadCount: 1,
      });
      await expect(
        chat.unreadCount({
          kind: 'SHOP',
          userId: lonely,
          shopId: suspended.shopId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('chỉ mục phục vụ truy vấn đọc', () => {
    // Bảng chỉ có ít hàng và (trên DB mới tinh như ở CI) chưa có thống kê nào, nên planner tự do chọn quét bất kỳ.
    // Trong MỘT transaction ta cấm quét tuần tự/bitmap, sort, hash join và merge join để kế hoạch hợp lệ duy nhất là dùng index — chứng
    // minh index CÓ THỂ phục vụ đúng các câu SQL này. Mỗi test lấy kế hoạch riêng.
    const explainWithoutScans = async (build: () => Prisma.Sql) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
        // Phép nối đúng ý đồ là VÒNG LẶP LỒNG (ít hội thoại trong phạm vi, mỗi hội thoại dò tin theo index); trên bảng
        // gần như trống planner có thể chọn hash/merge join đọc cả index messages — cấm hai kiểu đó để kế hoạch hợp lệ là
        // đúng cách dò mà truy vấn dùng ở quy mô thật.
        await tx.$executeRawUnsafe('SET LOCAL enable_hashjoin = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_mergejoin = off');
        const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>(
          Prisma.sql`EXPLAIN ${build()}`,
        );
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      });

    it('tin cuối của cả trang: mỗi hội thoại dò LIMIT 1 qua index (conversation_id, created_at, id) đã sắp xếp sẵn — không quét tuần tự, không sort', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1));

      const plan = await explainWithoutScans(() =>
        buildDigestQuery([conversationId], 'BUYER'),
      );

      expect(plan).toContain('messages_conversation_id_created_at_id_idx');
      expect(plan).not.toMatch(/Seq Scan on messages/);
      expect(plan).not.toMatch(/\bSort\b/);
    });

    // Phép đếm KHÔNG có ORDER BY nên nhiều index cùng dò được: (conversation_id, created_at, id), khoá duy nhất
    // (conversation_id, sender_id, client_message_id) hay (sender_id, created_at). Planner chọn cái nào tuỳ thống kê —
    // ở CI, trên DB mới tinh, nó chọn khác với máy dev — nên bản đầu của test này đòi đúng MỘT tên index đã đỏ ở CI
    // dù truy vấn hoàn toàn ổn. Điều cần khoá là: messages luôn được truy cập bằng index, không bao giờ quét cả bảng.
    it('đếm chưa đọc (huy hiệu): truy cập messages bằng index, không quét tuần tự cả bảng', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1));

      const plan = await explainWithoutScans(() =>
        buildUnreadCountQuery({ viewer: 'BUYER', userId: buyerId }),
      );

      expect(plan).toMatch(
        /Index (Only )?Scan( Backward)? using \w+ on messages/,
      );
      expect(plan).not.toMatch(/Seq Scan on messages/);
    });

    it('đếm chưa đọc của shop cũng vậy', async () => {
      const buyerId = await newBuyer();
      const side = await newShop();
      const conversationId = await open(buyerId, side.shopId);
      await insert(conversationId, buyerId, at(1));

      const plan = await explainWithoutScans(() =>
        buildUnreadCountQuery({ viewer: 'SHOP', shopId: side.shopId }),
      );

      expect(plan).toMatch(
        /Index (Only )?Scan( Backward)? using \w+ on messages/,
      );
      expect(plan).not.toMatch(/Seq Scan on messages/);
    });
  });
});
