import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, ShopStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { createFakeRealtimeEmitter } from '../../shared/testing/fake-realtime-emitter';
import {
  CHAT_MAX_UNANSWERED_MESSAGES,
  CHAT_NEW_CONVERSATIONS_LIMIT,
  CHAT_SEND_RATE_LIMIT,
} from './chat-config';
import { ChatModule } from './chat.module';
import { ChatService, type ChatActor } from './chat.service';

// Các giới hạn chống lạm dụng của chat phải đúng SAU KHI API khởi động lại và khi có NHIỀU instance dùng chung một
// DB (Week10.md 4.8, checklist bảo mật): chúng được đếm bằng truy vấn DB chứ không giữ trong bộ nhớ của tiến trình.
// "Khởi động lại" ở đây là đóng hẳn một Nest app rồi dựng app MỚI (bộ nhớ trống hoàn toàn); "hai instance" là hai
// app Nest đang sống cùng lúc, mỗi cái một ChatService riêng. Chạy: `pnpm test:int`.
//
// (Trạng thái "đang gõ" ở ChatGateway CÓ CHỦ Ý nằm trong bộ nhớ theo socket — xem chat-config.ts — nên không thuộc
// phạm vi các ca dưới đây.)
const TAG = 'it-chat-limits-';

describe('Giới hạn chat qua khởi động lại và nhiều instance (DB thật)', () => {
  const prisma = new PrismaClient();
  const live: TestingModule[] = [];
  let counter = 0;

  // Dựng một "instance" API mới: Nest app riêng, ChatService riêng, bộ nhớ trống.
  const boot = async (): Promise<ChatService> => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule, ChatModule],
    })
      .overrideProvider(REALTIME_EMITTER)
      .useValue(createFakeRealtimeEmitter())
      .compile();
    live.push(module);
    return module.get(ChatService);
  };
  const shutdown = async (service: ChatService) => {
    const index = live.findIndex((m) => m.get(ChatService) === service);
    const [module] = live.splice(index, 1);
    await module.close();
  };

  const makeShop = async (ownerId: string) =>
    (
      await prisma.shop.create({
        data: {
          ownerId,
          name: `${TAG}shop`,
          slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
          status: ShopStatus.APPROVED,
        },
        select: { id: true },
      })
    ).id;
  const newConversation = async (service: ChatService) => {
    const ownerId = (await createUser(prisma, TAG)).id;
    const buyerId = (await createUser(prisma, TAG)).id;
    const shopId = await makeShop(ownerId);
    const { id: conversationId } = await service.openConversation(
      buyerId,
      shopId,
    );
    const buyer: ChatActor = { kind: 'BUYER', userId: buyerId };
    const shop: ChatActor = { kind: 'SHOP', userId: ownerId, shopId };
    return { conversationId, buyerId, shopId, ownerId, buyer, shop };
  };
  const send = (
    service: ChatService,
    actor: ChatActor,
    conversationId: string,
    clientMessageId: string = randomUUID(),
  ) =>
    service.sendMessage(actor, conversationId, {
      content: 'xin chào',
      clientMessageId,
    });

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    for (const module of live.splice(0)) await module.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe(`tốc độ gửi (${CHAT_SEND_RATE_LIMIT} tin / 30 giây)`, () => {
    it('sau khi KHỞI ĐỘNG LẠI vẫn nhớ: instance mới chặn tin kế tiếp, nhưng vẫn cho gửi lại tin đã nhận', async () => {
      const before = await boot();
      const c = await newConversation(before);
      const firstId = randomUUID();
      await send(before, c.shop, c.conversationId, firstId);
      for (let i = 1; i < CHAT_SEND_RATE_LIMIT; i++) {
        await send(before, c.shop, c.conversationId);
      }
      await shutdown(before); // khởi động lại: bộ nhớ trống hoàn toàn
      const after = await boot();

      await expectAppException(send(after, c.shop, c.conversationId), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
      await expect(
        send(after, c.shop, c.conversationId, firstId),
      ).resolves.toMatchObject({ replayed: true });
    });

    it('HAI instance đang sống cùng lúc cộng chung một số đếm: mỗi bên gửi một nửa thì CẢ HAI cùng bị chặn', async () => {
      const [a, b] = [await boot(), await boot()];
      const c = await newConversation(a);
      for (let i = 0; i < CHAT_SEND_RATE_LIMIT / 2; i++) {
        await send(a, c.shop, c.conversationId);
        await send(b, c.shop, c.conversationId);
      }

      await expectAppException(send(a, c.shop, c.conversationId), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
      await expectAppException(send(b, c.shop, c.conversationId), {
        status: 429,
        code: 'CHAT_RATE_LIMITED',
      });
    });
  });

  describe(`trần ${CHAT_MAX_UNANSWERED_MESSAGES} tin chưa được trả lời (người mua)`, () => {
    it('sau khi KHỞI ĐỘNG LẠI vẫn nhớ; shop trả lời qua instance mới thì người mua gửi lại được', async () => {
      const before = await boot();
      const c = await newConversation(before);
      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES; i++) {
        await send(before, c.buyer, c.conversationId);
      }
      await shutdown(before);
      const after = await boot();

      await expectAppException(send(after, c.buyer, c.conversationId), {
        status: 429,
        code: 'CHAT_AWAITING_REPLY',
      });
      await send(after, c.shop, c.conversationId);
      await expect(
        send(after, c.buyer, c.conversationId),
      ).resolves.toBeDefined();
    });

    it('HAI instance cộng chung: người mua gửi xen kẽ qua hai instance vẫn chạm trần đúng chỗ', async () => {
      const [a, b] = [await boot(), await boot()];
      const c = await newConversation(a);
      for (let i = 0; i < CHAT_MAX_UNANSWERED_MESSAGES; i++) {
        await send(i % 2 ? a : b, c.buyer, c.conversationId);
      }

      await expectAppException(send(a, c.buyer, c.conversationId), {
        status: 429,
        code: 'CHAT_AWAITING_REPLY',
      });
      await expectAppException(send(b, c.buyer, c.conversationId), {
        status: 429,
        code: 'CHAT_AWAITING_REPLY',
      });
      // shop trả lời qua instance này thì mở lại cho người mua ở instance kia
      await send(a, c.shop, c.conversationId);
      await expect(send(b, c.buyer, c.conversationId)).resolves.toBeDefined();
    });
  });

  describe(`trần ${CHAT_NEW_CONVERSATIONS_LIMIT} hội thoại MỚI mỗi 24 giờ (người mua)`, () => {
    // Một người mua mở đủ trần hội thoại với các shop khác nhau qua `opener`; trả về người mua và các shop.
    const fillLimit = async (opener: ChatService) => {
      const buyerId = (await createUser(prisma, TAG)).id;
      const ownerId = (await createUser(prisma, TAG)).id;
      const shops: string[] = [];
      for (let i = 0; i < CHAT_NEW_CONVERSATIONS_LIMIT + 1; i++) {
        shops.push(await makeShop(ownerId));
      }
      for (const shopId of shops.slice(0, CHAT_NEW_CONVERSATIONS_LIMIT)) {
        await opener.openConversation(buyerId, shopId);
      }
      return { buyerId, shops };
    };

    it('sau khi KHỞI ĐỘNG LẠI vẫn nhớ; mở lại hội thoại đã có thì không bị chặn', async () => {
      const before = await boot();
      const { buyerId, shops } = await fillLimit(before);
      await shutdown(before);
      const after = await boot();

      await expectAppException(
        after.openConversation(buyerId, shops[CHAT_NEW_CONVERSATIONS_LIMIT]),
        {
          status: 429,
          code: 'CHAT_CONVERSATION_LIMIT',
        },
      );
      await expect(
        after.openConversation(buyerId, shops[0]),
      ).resolves.toMatchObject({ shopId: shops[0] });
    });

    it('HAI instance cộng chung: nửa trần mở ở instance này, nửa ở instance kia ⇒ cả hai cùng chặn hội thoại mới', async () => {
      const [a, b] = [await boot(), await boot()];
      const buyerId = (await createUser(prisma, TAG)).id;
      const ownerId = (await createUser(prisma, TAG)).id;
      const shops: string[] = [];
      for (let i = 0; i < CHAT_NEW_CONVERSATIONS_LIMIT + 1; i++) {
        shops.push(await makeShop(ownerId));
      }
      for (const [i, shopId] of shops
        .slice(0, CHAT_NEW_CONVERSATIONS_LIMIT)
        .entries()) {
        await (i % 2 ? a : b).openConversation(buyerId, shopId);
      }
      const extra = shops[CHAT_NEW_CONVERSATIONS_LIMIT];

      await expectAppException(a.openConversation(buyerId, extra), {
        status: 429,
        code: 'CHAT_CONVERSATION_LIMIT',
      });
      await expectAppException(b.openConversation(buyerId, extra), {
        status: 429,
        code: 'CHAT_CONVERSATION_LIMIT',
      });
    });
  });
});
