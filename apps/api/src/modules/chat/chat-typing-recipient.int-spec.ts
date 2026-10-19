import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, ShopStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag, createUser } from '../../shared/testing/db-fixtures';
import { createFakeRealtimeEmitter } from '../../shared/testing/fake-realtime-emitter';
import { ChatModule } from './chat.module';
import { ChatService } from './chat.service';

// Integration test trên Postgres THẬT cho việc xác định người nhận tín hiệu "đang gõ" (Week10.md 4.7): người
// nhận phải luôn suy ra từ DB, và mọi lý do không phải thành viên / hội thoại chưa có tin / shop không còn hoạt
// động đều cho cùng kết quả null. Cổng socket thật được kiểm ở e2e (test/chat-typing.e2e-spec.ts).
// Chạy: `pnpm test:int`.
const TAG = 'it-chat-typing-';

describe('ChatService.resolveTypingRecipient (DB thật)', () => {
  const prisma = new PrismaClient();
  let moduleFixture: TestingModule;
  let chat: ChatService;
  let counter = 0;

  const setup = async (status: ShopStatus = ShopStatus.APPROVED) => {
    const ownerId = (await createUser(prisma, TAG)).id;
    const buyerId = (await createUser(prisma, TAG)).id;
    const shop = await prisma.shop.create({
      data: {
        ownerId,
        name: `${TAG}shop`,
        slug: `${TAG}shop-${Date.now().toString(36)}-${counter++}`,
        status,
      },
      select: { id: true },
    });
    const conversation = await prisma.conversation.create({
      data: { buyerId, shopId: shop.id },
      select: { id: true },
    });
    return {
      ownerId,
      buyerId,
      shopId: shop.id,
      conversationId: conversation.id,
    };
  };
  // Một tin của người mua, kèm nâng lastMessageAt như sendMessage.
  const addFirstMessage = async (conversationId: string, buyerId: string) => {
    const at = new Date(Date.now() - 60_000);
    await prisma.message.create({
      data: {
        conversationId,
        senderId: buyerId,
        content: 'xin chào',
        createdAt: at,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at },
    });
  };

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    moduleFixture = await Test.createTestingModule({
      imports: [PrismaModule, ChatModule],
    })
      .overrideProvider(REALTIME_EMITTER)
      .useValue(createFakeRealtimeEmitter())
      .compile();
    chat = moduleFixture.get(ChatService);
  });

  afterAll(async () => {
    await moduleFixture.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('hội thoại đã có tin: người mua ⇒ chủ shop, chủ shop ⇒ người mua', async () => {
    const s = await setup();
    await addFirstMessage(s.conversationId, s.buyerId);

    expect(await chat.resolveTypingRecipient(s.buyerId, s.conversationId)).toBe(
      s.ownerId,
    );
    expect(await chat.resolveTypingRecipient(s.ownerId, s.conversationId)).toBe(
      s.buyerId,
    );
  });

  it('hội thoại CHƯA có tin ⇒ null cho cả hai phía (đối phương chưa thấy nó tồn tại)', async () => {
    const s = await setup();

    expect(
      await chat.resolveTypingRecipient(s.buyerId, s.conversationId),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(s.ownerId, s.conversationId),
    ).toBeNull();
  });

  it('người ngoài ⇒ null: người mua khác, chủ shop khác, chính người mua nhưng ở hội thoại của người khác', async () => {
    const mine = await setup();
    const theirs = await setup();
    await addFirstMessage(mine.conversationId, mine.buyerId);
    await addFirstMessage(theirs.conversationId, theirs.buyerId);

    expect(
      await chat.resolveTypingRecipient(theirs.buyerId, mine.conversationId),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(theirs.ownerId, mine.conversationId),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(mine.buyerId, theirs.conversationId),
    ).toBeNull();
  });

  it('shop bị khoá ⇒ null (hội thoại chỉ đọc); mở khoá ⇒ lại có người nhận', async () => {
    const s = await setup();
    await addFirstMessage(s.conversationId, s.buyerId);
    await prisma.shop.update({
      where: { id: s.shopId },
      data: { status: ShopStatus.SUSPENDED },
    });

    expect(
      await chat.resolveTypingRecipient(s.buyerId, s.conversationId),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(s.ownerId, s.conversationId),
    ).toBeNull();

    await prisma.shop.update({
      where: { id: s.shopId },
      data: { status: ShopStatus.APPROVED },
    });
    expect(await chat.resolveTypingRecipient(s.buyerId, s.conversationId)).toBe(
      s.ownerId,
    );
  });

  it('hội thoại không tồn tại hoặc id rác ⇒ null, không lỗi', async () => {
    const s = await setup();

    expect(
      await chat.resolveTypingRecipient(s.buyerId, randomUUID()),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(s.buyerId, 'khong-phai-uuid'),
    ).toBeNull();
    expect(
      await chat.resolveTypingRecipient(s.buyerId, "' OR 1=1 --"),
    ).toBeNull();
  });
});
