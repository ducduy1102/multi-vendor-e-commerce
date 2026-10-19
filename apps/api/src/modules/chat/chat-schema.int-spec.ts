import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  cleanupByTag,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';

// Integration test trên Postgres THẬT cho các BẤT BIẾN của schema chat (Week10.md 4.1). Đây là lưới an toàn cuối,
// nên test đi VÒNG qua service (ghi thẳng bằng Prisma): ràng buộc phải đúng kể cả khi service có lỗi.
// Chạy: `pnpm test:int`.
const TAG = 'it-chat-schema-';

describe('Schema chat (DB thật)', () => {
  const prisma = new PrismaClient();
  let buyerId: string;
  let otherBuyerId: string;
  let ownerId: string;
  let shopId: string;
  let conversationId: string;
  let otherConversationId: string;

  const send = (
    content: string,
    options: {
      conversationId?: string;
      senderId?: string;
      clientMessageId?: string | null;
    } = {},
  ) =>
    prisma.message.create({
      data: {
        content,
        conversationId: options.conversationId ?? conversationId,
        senderId: options.senderId ?? buyerId,
        clientMessageId: options.clientMessageId ?? null,
      },
    });

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const shop = await createShopWithProduct(prisma, TAG);
    shopId = shop.shopId;
    ownerId = shop.ownerId;
    buyerId = (await createUser(prisma, TAG)).id;
    otherBuyerId = (await createUser(prisma, TAG)).id;
    conversationId = (
      await prisma.conversation.create({ data: { buyerId, shopId } })
    ).id;
    otherConversationId = (
      await prisma.conversation.create({
        data: { buyerId: otherBuyerId, shopId },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('hội thoại', () => {
    it('cột mới mặc định NULL: chưa có tin, chưa ai đọc', async () => {
      const row = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });

      expect(row.lastMessageAt).toBeNull();
      expect(row.buyerLastReadAt).toBeNull();
      expect(row.shopLastReadAt).toBeNull();
    });

    it('vẫn chỉ MỘT hội thoại cho mỗi cặp (người mua, shop)', async () => {
      await expect(
        prisma.conversation.create({ data: { buyerId, shopId } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('xoá người mua kéo theo hội thoại và tin của họ (cascade), shop/chủ shop không bị ảnh hưởng', async () => {
      const temp = await createUser(prisma, TAG);
      const conv = await prisma.conversation.create({
        data: { buyerId: temp.id, shopId },
      });
      await send('sẽ bị xoá cùng người mua', {
        conversationId: conv.id,
        senderId: temp.id,
      });
      // Tin của chủ shop trong hội thoại đó cũng phải mất khi hội thoại mất.
      await send('phản hồi của shop', {
        conversationId: conv.id,
        senderId: ownerId,
      });
      // Người mua xoá mà còn tin do họ gửi: sender là RESTRICT nên phải xoá tin của họ trước (đúng cách
      // cleanupByTag làm) — chứng minh FK sender vẫn là RESTRICT, không ngầm cascade.
      await expect(
        prisma.user.delete({ where: { id: temp.id } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

      await prisma.message.deleteMany({ where: { senderId: temp.id } });
      await prisma.user.delete({ where: { id: temp.id } });

      expect(await prisma.conversation.count({ where: { id: conv.id } })).toBe(
        0,
      );
      expect(
        await prisma.message.count({ where: { conversationId: conv.id } }),
      ).toBe(0);
      expect(await prisma.user.count({ where: { id: ownerId } })).toBe(1);
    });
  });

  describe('CHECK độ dài nội dung (1..1000 ký tự)', () => {
    it.each([
      ['rỗng', ''],
      ['1001 ký tự', 'a'.repeat(1001)],
      ['5000 ký tự', 'a'.repeat(5000)],
    ])('từ chối nội dung %s', async (_name, content) => {
      await expect(send(content)).rejects.toThrow(
        /messages_content_length_in_range|constraint/i,
      );
    });

    it.each([
      ['1 ký tự', 'a'],
      ['đúng 1000 ký tự', 'a'.repeat(1000)],
      ['nhiều dòng', 'dòng 1\ndòng 2\n\ndòng 4'],
    ])('chấp nhận nội dung %s', async (_name, content) => {
      const row = await send(content);

      expect(row.content).toBe(content);
    });

    it('đếm KÝ TỰ chứ không đếm đơn vị UTF-16: 1000 emoji (2000 đơn vị) vẫn qua CHECK — Zod mới là hàng rào chặt hơn', async () => {
      const content = '😀'.repeat(1000);
      expect(content.length).toBe(2000);

      const row = await send(content);

      expect(Array.from(row.content)).toHaveLength(1000);
    });

    it('nội dung chứa <script>, <img onerror> được lưu NGUYÊN VĂN như chữ (không HTML hoá ở DB)', async () => {
      const content = '<img src=x onerror=alert(1)><script>alert(2)</script>';

      const row = await send(content);

      expect(row.content).toBe(content);
    });
  });

  describe('idempotency theo clientMessageId', () => {
    it('cùng (hội thoại, người gửi, clientMessageId) ⇒ P2002; chỉ còn đúng 1 tin', async () => {
      const clientMessageId = randomUUID();
      await send('lần 1', { clientMessageId });

      await expect(
        send('lần 2 (gửi lại)', { clientMessageId }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const rows = await prisma.message.findMany({
        where: { conversationId, senderId: buyerId, clientMessageId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('lần 1');
    });

    it('cùng clientMessageId nhưng KHÁC người gửi hoặc KHÁC hội thoại ⇒ được phép (khoá là bộ ba)', async () => {
      const clientMessageId = randomUUID();
      await send('buyer', { clientMessageId });

      await expect(
        send('chủ shop dùng trùng khoá', {
          senderId: ownerId,
          clientMessageId,
        }),
      ).resolves.toBeDefined();
      await expect(
        send('buyer khác hội thoại', {
          conversationId: otherConversationId,
          senderId: otherBuyerId,
          clientMessageId,
        }),
      ).resolves.toBeDefined();
    });

    it('không có clientMessageId (NULL) ⇒ không bao giờ xung đột, gửi bao nhiêu tin cũng được', async () => {
      await send('a');
      await send('a');
      await send('a');

      const count = await prisma.message.count({
        where: { conversationId, content: 'a', clientMessageId: null },
      });
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('clientMessageId phải là UUID hợp lệ (kiểu uuid của Postgres)', async () => {
      await expect(
        send('x', { clientMessageId: 'khong-phai-uuid' }),
      ).rejects.toBeDefined();
    });

    it('10 lần ghi ĐỒNG THỜI cùng một clientMessageId ⇒ đúng 1 thành công, 9 bị P2002', async () => {
      const clientMessageId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          send(`song song ${i}`, { clientMessageId }),
        ),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(9);
      for (const f of failed) expect(f.reason).toMatchObject({ code: 'P2002' });
    });
  });

  describe('chỉ mục theo thiết kế', () => {
    it('có các index mới và KHÔNG còn các index đơn cũ đã bị thay', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('conversations', 'messages')`;
      const names = rows.map((r) => r.indexname);

      expect(names).toEqual(
        expect.arrayContaining([
          'conversations_shop_id_last_message_at_idx',
          'conversations_buyer_id_last_message_at_idx',
          'conversations_buyer_id_shop_id_key',
          'messages_conversation_id_created_at_id_idx',
          'messages_sender_id_created_at_idx',
          'messages_conversation_id_sender_id_client_message_id_key',
        ]),
      );
      expect(names).not.toContain('conversations_shop_id_idx');
      expect(names).not.toContain('messages_conversation_id_idx');
      expect(names).not.toContain('messages_sender_id_idx');
    });

    it('truy vấn danh sách + phân trang được phục vụ bằng đúng index composite, KHÔNG cần sắp xếp lại', async () => {
      // Bảng chỉ có vài hàng nên planner tự do chọn quét bất kỳ. Trong MỘT transaction, cấm quét tuần tự, quét bitmap
      // và cấm bước sort: kế hoạch hợp lệ duy nhất là index đã sắp xếp sẵn theo ORDER BY — chứng minh index
      // composite CÓ THỂ phục vụ đúng WHERE + ORDER BY mà không phải sort lại.
      const plans = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
        await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
        const list = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM conversations
          WHERE shop_id = ${shopId} AND last_message_at IS NOT NULL
          ORDER BY last_message_at DESC LIMIT 20`;
        const page = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM messages
          WHERE conversation_id = ${conversationId}
          ORDER BY created_at DESC, id DESC LIMIT 30`;
        return { list, page };
      });

      const text = (rows: { 'QUERY PLAN': string }[]) =>
        rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(text(plans.list)).toContain(
        'conversations_shop_id_last_message_at_idx',
      );
      expect(text(plans.page)).toContain(
        'messages_conversation_id_created_at_id_idx',
      );
    });
  });
});
