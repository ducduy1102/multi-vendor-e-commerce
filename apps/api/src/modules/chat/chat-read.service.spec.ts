import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import {
  CHAT_PREVIEW_MAX_LENGTH,
  chatReadPayloadSchema,
} from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor';
import type { ChatShopInfo } from './chat-directory';
import { ChatService, type ChatActor } from './chat.service';

const CONVERSATION_ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const CONVERSATION_2 = '1679091c-5a88-4faf-afb5-e6e2f2d6a001';
const CONVERSATION_3 = '1679091c-5a88-4faf-afb5-e6e2f2d6a002';
const BUYER = 'buyer-1';
const BUYER_2 = 'buyer-2';
const OWNER = 'owner-1';
const SHOP_ID = 'c4ca4238-a0b9-4382-8dcc-509a6f75849b';
const SHOP_2 = 'c81e728d-9d4c-4f6b-8a0a-2e36b2f8b3a2';
const T1 = new Date('2030-01-02T12:00:01.000Z');
const T2 = new Date('2030-01-02T12:00:02.000Z');
const T3 = new Date('2030-01-02T12:00:03.000Z');
const CREATED = new Date('2030-01-01T00:00:00.000Z');

const buyerActor: ChatActor = { kind: 'BUYER', userId: BUYER };
const shopActor: ChatActor = { kind: 'SHOP', userId: OWNER, shopId: SHOP_ID };

const conversationRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONVERSATION_ID,
  buyerId: BUYER,
  shopId: SHOP_ID,
  createdAt: CREATED,
  buyerLastReadAt: null,
  shopLastReadAt: null,
  lastMessageAt: T2,
  ...overrides,
});
const shopInfo = (overrides: Partial<ChatShopInfo> = {}): ChatShopInfo => ({
  id: SHOP_ID,
  ownerId: OWNER,
  status: ShopStatus.APPROVED,
  name: 'Shop Áo',
  logoUrl: 'https://img.test/logo.png',
  ...overrides,
});
const digest = (overrides: Record<string, unknown> = {}) => ({
  conversationId: CONVERSATION_ID,
  content: 'xin chào',
  senderId: OWNER,
  createdAt: T2,
  unreadCount: 3,
  ...overrides,
});
const messageRow = (id: string, createdAt: Date, senderId = BUYER) => ({
  id,
  conversationId: CONVERSATION_ID,
  senderId,
  content: `tin ${id}`,
  createdAt,
  clientMessageId: `00000000-0000-4000-8000-${id.slice(-12)}`,
});
const uuid = (n: number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

describe('ChatService — phần đọc', () => {
  let service: ChatService;
  let realtime: FakeRealtimeEmitter;
  let prisma: {
    conversation: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    message: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let directory: {
    getShopForChat: jest.Mock;
    getShopsForChat: jest.Mock;
    getUserDisplay: jest.Mock;
  };

  beforeEach(() => {
    realtime = createFakeRealtimeEmitter();
    prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue(conversationRow()),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    directory = {
      getShopForChat: jest.fn().mockResolvedValue(shopInfo()),
      getShopsForChat: jest.fn().mockResolvedValue([shopInfo()]),
      getUserDisplay: jest.fn().mockResolvedValue([]),
    };
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

  // Ma trận "không phải thành viên ⇒ 404" dùng chung cho mọi thao tác theo hội thoại.
  const NON_MEMBERS: [string, ChatActor][] = [
    ['người mua KHÁC', { kind: 'BUYER', userId: BUYER_2 }],
    ['chủ shop đi nhầm sang route NGƯỜI MUA', { kind: 'BUYER', userId: OWNER }],
    ['người lạ', { kind: 'BUYER', userId: 'stranger' }],
    [
      'chủ một shop KHÁC (route shop khác)',
      { kind: 'SHOP', userId: 'owner-2', shopId: SHOP_2 },
    ],
    [
      'chủ shop khác mạo shopId của hội thoại',
      { kind: 'SHOP', userId: 'owner-2', shopId: SHOP_ID },
    ],
    [
      'chủ shop thật nhưng route trỏ shop khác',
      { kind: 'SHOP', userId: OWNER, shopId: SHOP_2 },
    ],
    [
      'người mua đi route SHOP',
      { kind: 'SHOP', userId: BUYER, shopId: SHOP_ID },
    ],
  ];

  describe('listConversations', () => {
    const list = (
      actor: ChatActor = buyerActor,
      query: Record<string, unknown> = {},
    ) =>
      service.listConversations(actor, {
        limit: 20,
        ...query,
      });

    describe('truy vấn', () => {
      it('người mua: chỉ hội thoại của MÌNH và ĐÃ có tin, mới nhất trước (khoá phụ id), lấy thừa 1 dòng để biết còn trang sau', async () => {
        await list(buyerActor);

        expect(prisma.conversation.findMany).toHaveBeenCalledWith({
          where: { buyerId: BUYER, lastMessageAt: { not: null } },
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
          take: 21,
          select: expect.objectContaining({
            id: true,
            buyerId: true,
            shopId: true,
            lastMessageAt: true,
          }) as unknown,
        });
      });

      it('mặc định 20 hội thoại / trang khi không truyền limit', async () => {
        await service.listConversations(buyerActor, {} as never);

        expect(prisma.conversation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ take: 21 }),
        );
      });

      it('chủ shop: lọc theo shopId LẤY TỪ DB (không phải từ tham số) sau khi xác nhận sở hữu', async () => {
        directory.getShopForChat.mockResolvedValue(
          shopInfo({ id: 'shop-from-db' }),
        );

        await list({ ...shopActor, shopId: 'shop-from-db' });

        expect(directory.getShopForChat).toHaveBeenCalledWith('shop-from-db');
        expect(prisma.conversation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { shopId: 'shop-from-db', lastMessageAt: { not: null } },
          }),
        );
      });

      it.each([
        ['shop không tồn tại', null],
        [
          'người gọi không phải chủ shop',
          shopInfo({ ownerId: 'someone-else' }),
        ],
      ])('chủ shop: %s ⇒ 404 và không truy vấn hội thoại', async (_n, shop) => {
        directory.getShopForChat.mockResolvedValue(shop);

        await expect(list(shopActor)).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.conversation.findMany).not.toHaveBeenCalled();
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      });

      it('shop KHÔNG còn APPROVED vẫn xem được hộp thư của mình (chế độ chỉ đọc)', async () => {
        directory.getShopForChat.mockResolvedValue(
          shopInfo({ status: ShopStatus.SUSPENDED }),
        );
        prisma.conversation.findMany.mockResolvedValue([conversationRow()]);
        prisma.$queryRaw.mockResolvedValue([digest()]);
        directory.getUserDisplay.mockResolvedValue([{ id: BUYER, name: 'An' }]);

        const result = await list(shopActor);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].isReadOnly).toBe(true);
      });
    });

    describe('không N+1', () => {
      const three = [
        conversationRow({
          id: CONVERSATION_ID,
          shopId: SHOP_ID,
          lastMessageAt: T3,
        }),
        conversationRow({
          id: CONVERSATION_2,
          shopId: SHOP_2,
          lastMessageAt: T2,
        }),
        conversationRow({
          id: CONVERSATION_3,
          shopId: SHOP_ID,
          lastMessageAt: T1,
        }),
      ];

      it('người mua: MỘT truy vấn nhóm cho tin cuối + chưa đọc của cả trang và MỘT lượt tra shop', async () => {
        prisma.conversation.findMany.mockResolvedValue(three);
        prisma.$queryRaw.mockResolvedValue(
          three.map((c) => digest({ conversationId: c.id })),
        );
        directory.getShopsForChat.mockResolvedValue([
          shopInfo(),
          shopInfo({ id: SHOP_2, name: 'Shop Giày' }),
        ]);

        const result = await list(buyerActor);

        expect(result.items).toHaveLength(3);
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(directory.getShopsForChat).toHaveBeenCalledTimes(1);
        expect(directory.getShopsForChat).toHaveBeenCalledWith([
          SHOP_ID,
          SHOP_2,
          SHOP_ID,
        ]);
        expect(directory.getUserDisplay).not.toHaveBeenCalled();
      });

      it('chủ shop: MỘT truy vấn nhóm và MỘT lượt tra tên người mua; không tra danh sách shop', async () => {
        prisma.conversation.findMany.mockResolvedValue([
          conversationRow({ id: CONVERSATION_ID, buyerId: BUYER }),
          conversationRow({ id: CONVERSATION_2, buyerId: BUYER_2 }),
        ]);
        prisma.$queryRaw.mockResolvedValue([
          digest({ conversationId: CONVERSATION_ID, senderId: BUYER }),
          digest({ conversationId: CONVERSATION_2, senderId: BUYER_2 }),
        ]);
        directory.getUserDisplay.mockResolvedValue([
          { id: BUYER, name: 'An' },
          { id: BUYER_2, name: 'Bình' },
        ]);

        const result = await list(shopActor);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(directory.getUserDisplay).toHaveBeenCalledTimes(1);
        expect(directory.getUserDisplay).toHaveBeenCalledWith([BUYER, BUYER_2]);
        expect(directory.getShopsForChat).not.toHaveBeenCalled();
        expect(result.items.map((i) => i.counterpart.name)).toEqual([
          'An',
          'Bình',
        ]);
      });

      it('truy vấn nhóm nhận đúng vai người xem (BUYER / SHOP) để chọn mốc đã đọc đúng cột', async () => {
        prisma.conversation.findMany.mockResolvedValue([conversationRow()]);
        prisma.$queryRaw.mockResolvedValue([digest()]);
        directory.getUserDisplay.mockResolvedValue([{ id: BUYER, name: 'An' }]);

        await list(buyerActor);
        await list(shopActor);

        const [buyerSql, shopSql] = prisma.$queryRaw.mock.calls.map(
          (call: [Prisma.Sql]) => call[0].sql,
        );
        expect(buyerSql).toContain('c.buyer_last_read_at');
        expect(buyerSql).not.toContain('c.shop_last_read_at');
        expect(shopSql).toContain('c.shop_last_read_at');
        expect(shopSql).not.toContain('c.buyer_last_read_at');
      });

      it('trang rỗng ⇒ { items: [], nextCursor: null } và KHÔNG gọi truy vấn nhóm hay danh bạ', async () => {
        const result = await list(buyerActor);

        expect(result).toEqual({ items: [], nextCursor: null });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        expect(directory.getShopsForChat).not.toHaveBeenCalled();
      });
    });

    describe('dựng từng mục', () => {
      beforeEach(() => {
        prisma.conversation.findMany.mockResolvedValue([
          conversationRow({ lastMessageAt: T2 }),
        ]);
      });

      it('người mua thấy tên + logo SHOP; chỉ đúng các trường của hợp đồng (không email, không ownerId)', async () => {
        prisma.$queryRaw.mockResolvedValue([
          digest({ content: 'shop trả lời', senderId: OWNER, unreadCount: 2 }),
        ]);

        const result = await list(buyerActor);

        expect(result.items).toEqual([
          {
            id: CONVERSATION_ID,
            shopId: SHOP_ID,
            counterpart: {
              name: 'Shop Áo',
              logoUrl: 'https://img.test/logo.png',
            },
            lastMessage: {
              content: 'shop trả lời',
              senderRole: 'SHOP',
              createdAt: T2.toISOString(),
            },
            lastMessageAt: T2.toISOString(),
            unreadCount: 2,
            isReadOnly: false,
          },
        ]);
      });

      it('chủ shop thấy tên NGƯỜI MUA, logo luôn null, và vai tin cuối suy ra từ buyerId', async () => {
        prisma.$queryRaw.mockResolvedValue([
          digest({ content: 'còn hàng không', senderId: BUYER }),
        ]);
        directory.getUserDisplay.mockResolvedValue([
          { id: BUYER, name: 'Nguyễn An' },
        ]);

        const result = await list(shopActor);

        expect(result.items[0].counterpart).toEqual({
          name: 'Nguyễn An',
          logoUrl: null,
        });
        expect(result.items[0].lastMessage?.senderRole).toBe('BUYER');
        expect(result.items[0].isReadOnly).toBe(false);
      });

      it('tin cuối bị rút gọn: gộp xuống dòng/khoảng trắng và cắt theo ký tự', async () => {
        prisma.$queryRaw.mockResolvedValue([
          digest({ content: `dòng 1\n\n  dòng 2 ${'x'.repeat(300)}` }),
        ]);

        const result = await list(buyerActor);

        const preview = result.items[0].lastMessage?.content ?? '';
        expect(preview.startsWith('dòng 1 dòng 2 xxx')).toBe(true);
        expect(Array.from(preview)).toHaveLength(CHAT_PREVIEW_MAX_LENGTH);
        expect(preview.endsWith('…')).toBe(true);
      });

      it.each([
        ['SUSPENDED', ShopStatus.SUSPENDED],
        ['REJECTED', ShopStatus.REJECTED],
        ['PENDING', ShopStatus.PENDING],
      ])(
        'shop %s ⇒ isReadOnly true cho người mua (vẫn hiện để đọc lại)',
        async (_n, status) => {
          prisma.$queryRaw.mockResolvedValue([digest()]);
          directory.getShopsForChat.mockResolvedValue([shopInfo({ status })]);

          const result = await list(buyerActor);

          expect(result.items[0].isReadOnly).toBe(true);
        },
      );

      it('mục thiếu dữ liệu (không có tin cuối / không tra được đối phương) bị bỏ qua, không làm hỏng cả trang', async () => {
        prisma.conversation.findMany.mockResolvedValue([
          conversationRow({ id: CONVERSATION_ID, shopId: SHOP_ID }),
          conversationRow({ id: CONVERSATION_2, shopId: SHOP_2 }),
          conversationRow({ id: CONVERSATION_3, shopId: SHOP_ID }),
        ]);
        prisma.$queryRaw.mockResolvedValue([
          digest({ conversationId: CONVERSATION_ID }),
          digest({ conversationId: CONVERSATION_2 }),
        ]);
        directory.getShopsForChat.mockResolvedValue([shopInfo()]);

        const result = await list(buyerActor);

        expect(result.items.map((i) => i.id)).toEqual([CONVERSATION_ID]);
      });
    });

    describe('phân trang theo con trỏ (lastMessageAt, id)', () => {
      const rows = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          conversationRow({
            id: uuid(i + 1),
            lastMessageAt: new Date(T3.getTime() - i * 1000),
          }),
        );
      const digestsFor = (rs: { id: string }[]) =>
        rs.map((r) => digest({ conversationId: r.id }));

      it('còn trang sau ⇒ nextCursor là con trỏ của hội thoại CUỐI trang và dòng thừa bị cắt', async () => {
        const all = rows(3);
        prisma.conversation.findMany.mockResolvedValue(all);
        prisma.$queryRaw.mockResolvedValue(digestsFor(all));

        const result = await list(buyerActor, { limit: 2 });

        expect(result.items.map((i) => i.id)).toEqual([uuid(1), uuid(2)]);
        expect(prisma.conversation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ take: 3 }),
        );
        expect(decodeChatCursor(result.nextCursor ?? '')).toEqual({
          at: all[1].lastMessageAt,
          id: uuid(2),
        });
      });

      it('đúng bằng limit dòng ⇒ hết, nextCursor null (không hứa trang trống)', async () => {
        const all = rows(2);
        prisma.conversation.findMany.mockResolvedValue(all);
        prisma.$queryRaw.mockResolvedValue(digestsFor(all));

        const result = await list(buyerActor, { limit: 2 });

        expect(result.items).toHaveLength(2);
        expect(result.nextCursor).toBeNull();
      });

      it('có con trỏ ⇒ lấy các hội thoại SAU nó: cũ hơn, hoặc cùng mili-giây nhưng id nhỏ hơn', async () => {
        const before = encodeChatCursor({ at: T2, id: uuid(5) });

        await list(buyerActor, { before });

        expect(prisma.conversation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              buyerId: BUYER,
              lastMessageAt: { not: null },
              OR: [
                { lastMessageAt: { lt: T2 } },
                { lastMessageAt: T2, id: { lt: uuid(5) } },
              ],
            },
          }),
        );
      });

      it.each([
        ['không phải con trỏ', 'not-a-cursor!'],
        ['con trỏ giả mạo', 'AAAA'],
      ])('%s ⇒ 400 trước khi chạm DB', async (_n, before) => {
        await expect(list(buyerActor, { before })).rejects.toBeInstanceOf(
          BadRequestException,
        );

        expect(prisma.conversation.findMany).not.toHaveBeenCalled();
        expect(directory.getShopForChat).not.toHaveBeenCalled();
      });

      it.each([
        ['limit 0', { limit: 0 }],
        ['limit âm', { limit: -1 }],
        ['limit vượt trần 50', { limit: 51 }],
        ['limit không phải số', { limit: 'abc' }],
        ['limit thập phân', { limit: 1.5 }],
      ])('%s ⇒ 400 trước khi chạm DB', async (_n, query) => {
        await expect(list(buyerActor, query)).rejects.toBeInstanceOf(
          BadRequestException,
        );

        expect(prisma.conversation.findMany).not.toHaveBeenCalled();
      });

      it('limit ở biên 1 và 50 được nhận', async () => {
        await list(buyerActor, { limit: 1 });
        await list(buyerActor, { limit: 50 });

        expect(
          prisma.conversation.findMany.mock.calls.map(
            (call: [{ take: number }]) => call[0].take,
          ),
        ).toEqual([2, 51]);
      });
    });
  });

  describe('listMessages', () => {
    const listMessages = (
      actor: ChatActor = buyerActor,
      query: Record<string, unknown> = {},
      conversationId = CONVERSATION_ID,
    ) =>
      service.listMessages(actor, conversationId, {
        limit: 30,
        ...query,
      });

    it.each(NON_MEMBERS)('%s ⇒ 404 và không đọc tin nào', async (_n, actor) => {
      await expect(listMessages(actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('hội thoại không tồn tại ⇒ 404', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(listMessages()).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('người mua và chủ shop của hội thoại đều đọc được', async () => {
      await expect(listMessages(buyerActor)).resolves.toBeDefined();
      await expect(listMessages(shopActor)).resolves.toBeDefined();
    });

    it('shop KHÔNG còn APPROVED vẫn đọc được lịch sử (chỉ chặn gửi)', async () => {
      directory.getShopForChat.mockResolvedValue(
        shopInfo({ status: ShopStatus.SUSPENDED }),
      );

      await expect(listMessages(buyerActor)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      await expect(listMessages(shopActor)).resolves.toBeDefined();
    });

    it('truy vấn: id hội thoại lấy từ DB, mới nhất trước với khoá phụ id, lấy thừa 1 dòng', async () => {
      await listMessages(buyerActor, { limit: 30 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 31,
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          createdAt: true,
          clientMessageId: true,
        },
      });
    });

    it('mặc định 30 tin / trang', async () => {
      await service.listMessages(buyerActor, CONVERSATION_ID, {} as never);

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 31 }),
      );
    });

    it('có con trỏ ⇒ lấy tin cũ hơn, hoặc CÙNG mili-giây nhưng id nhỏ hơn (không trùng, không mất)', async () => {
      const before = encodeChatCursor({ at: T2, id: uuid(9) });

      await listMessages(buyerActor, { before });

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: CONVERSATION_ID,
            OR: [
              { createdAt: { lt: T2 } },
              { createdAt: T2, id: { lt: uuid(9) } },
            ],
          },
        }),
      );
    });

    it('con trỏ xấu ⇒ 400 trước khi đọc hội thoại', async () => {
      await expect(
        listMessages(buyerActor, { before: 'xxx!' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it.each([0, 51, -3])('limit %s ⇒ 400', async (limit) => {
      await expect(listMessages(buyerActor, { limit })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    describe('phân trang', () => {
      const messages = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          messageRow(uuid(100 + i), new Date(T3.getTime() - i * 1000)),
        );

      it('còn trang sau ⇒ cắt dòng thừa, nextCursor = con trỏ của tin CUỐI trang', async () => {
        const rows = messages(4);
        prisma.message.findMany.mockResolvedValue(rows);

        const result = await listMessages(buyerActor, { limit: 3 });

        expect(result.items.map((m) => m.id)).toEqual(
          rows.slice(0, 3).map((m) => m.id),
        );
        expect(decodeChatCursor(result.nextCursor ?? '')).toEqual({
          at: rows[2].createdAt,
          id: rows[2].id,
        });
      });

      it('đúng bằng limit ⇒ nextCursor null', async () => {
        prisma.message.findMany.mockResolvedValue(messages(3));

        const result = await listMessages(buyerActor, { limit: 3 });

        expect(result.items).toHaveLength(3);
        expect(result.nextCursor).toBeNull();
      });

      it('hai tin CÙNG mili-giây vẫn có hai con trỏ khác nhau nhờ id (không trùng/mất giữa các trang)', async () => {
        const same = [
          messageRow(uuid(2), T2),
          messageRow(uuid(1), T2),
          messageRow(uuid(0), T1),
        ];
        prisma.message.findMany.mockResolvedValue(same);
        const first = await listMessages(buyerActor, { limit: 1 });
        prisma.message.findMany.mockResolvedValue(same.slice(1));
        const second = await listMessages(buyerActor, { limit: 1 });

        expect(first.nextCursor).not.toBeNull();
        expect(first.nextCursor).not.toBe(second.nextCursor);
        expect(decodeChatCursor(first.nextCursor ?? '')?.id).toBe(uuid(2));
        expect(decodeChatCursor(second.nextCursor ?? '')?.id).toBe(uuid(1));
      });
    });

    describe('dựng từng tin', () => {
      const buyerMsg = messageRow(uuid(1), T1, BUYER);
      const shopMsg = messageRow(uuid(2), T2, OWNER);

      beforeEach(() => {
        prisma.message.findMany.mockResolvedValue([shopMsg, buyerMsg]);
      });

      it('vai người gửi suy ra từ buyerId của hội thoại (không từ client)', async () => {
        const result = await listMessages(buyerActor);

        expect(result.items.map((m) => m.senderRole)).toEqual([
          'SHOP',
          'BUYER',
        ]);
      });

      it('người mua chỉ thấy clientMessageId trên tin CỦA MÌNH', async () => {
        const result = await listMessages(buyerActor);

        expect(result.items[0].clientMessageId).toBeUndefined();
        expect(result.items[1].clientMessageId).toBe(buyerMsg.clientMessageId);
      });

      it('chủ shop chỉ thấy clientMessageId trên tin CỦA MÌNH (không thấy của người mua)', async () => {
        const result = await listMessages(shopActor);

        expect(result.items[0].clientMessageId).toBe(shopMsg.clientMessageId);
        expect(result.items[1].clientMessageId).toBeUndefined();
      });

      it('mỗi tin chỉ có đúng các trường của hợp đồng (không lộ senderId)', async () => {
        const result = await listMessages(buyerActor);

        expect(Object.keys(result.items[0]).sort()).toEqual(
          ['content', 'conversationId', 'createdAt', 'id', 'senderRole'].sort(),
        );
        expect(result.items[0].createdAt).toBe(T2.toISOString());
      });
    });
  });

  describe('markRead', () => {
    const markRead = (
      actor: ChatActor = buyerActor,
      conversationId = CONVERSATION_ID,
    ) => service.markRead(actor, conversationId);

    it.each(NON_MEMBERS)(
      '%s ⇒ 404, không ghi gì, không đẩy sự kiện',
      async (_n, actor) => {
        await expect(markRead(actor)).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
        expect(realtime.emitted).toEqual([]);
      },
    );

    it('hội thoại không tồn tại ⇒ 404', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(markRead()).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    });

    describe('người mua đánh dấu', () => {
      it('đặt buyerLastReadAt = lastMessageAt bằng UPDATE có điều kiện (NULL hoặc cũ hơn) — không đọc-rồi-ghi', async () => {
        const result = await markRead(buyerActor);

        expect(prisma.conversation.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
          where: {
            id: CONVERSATION_ID,
            OR: [{ buyerLastReadAt: null }, { buyerLastReadAt: { lt: T2 } }],
          },
          data: { buyerLastReadAt: T2 },
        });
        expect(result).toEqual({ readAt: T2.toISOString() });
      });

      it('đẩy chat:read tới ĐÚNG chủ shop (suy ra từ DB), một lần, và payload đúng hợp đồng', async () => {
        await markRead(buyerActor);

        expect(realtime.emitted).toHaveLength(1);
        const [event] = realtime.emitted;
        expect(event.userId).toBe(OWNER);
        expect(event.event).toBe('chat:read');
        expect(chatReadPayloadSchema.parse(event.payload)).toEqual({
          conversationId: CONVERSATION_ID,
          readAt: T2.toISOString(),
        });
      });

      it('KHÔNG đẩy tới chính người đánh dấu', async () => {
        await markRead(buyerActor);

        expect(realtime.emitted.map((e) => e.userId)).not.toContain(BUYER);
      });
    });

    describe('chủ shop đánh dấu', () => {
      it('đặt shopLastReadAt (không đụng mốc của người mua)', async () => {
        await markRead(shopActor);

        expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
          where: {
            id: CONVERSATION_ID,
            OR: [{ shopLastReadAt: null }, { shopLastReadAt: { lt: T2 } }],
          },
          data: { shopLastReadAt: T2 },
        });
      });

      it('đẩy chat:read tới ĐÚNG người mua của hội thoại, không tới chủ shop', async () => {
        await markRead(shopActor);

        expect(realtime.emitted).toHaveLength(1);
        expect(realtime.emitted[0].userId).toBe(BUYER);
        expect(realtime.emitted.map((e) => e.userId)).not.toContain(OWNER);
      });
    });

    describe('mốc chỉ tăng, không bao giờ lùi', () => {
      it('mốc đã ở mức đó (UPDATE không khớp dòng nào) ⇒ KHÔNG đẩy sự kiện, trả mốc hiện có', async () => {
        prisma.conversation.findUnique.mockResolvedValue(
          conversationRow({ buyerLastReadAt: T2 }),
        );
        prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

        const result = await markRead(buyerActor);

        expect(realtime.emitted).toEqual([]);
        expect(result).toEqual({ readAt: T2.toISOString() });
      });

      it('mốc hiện có CAO hơn lastMessageAt ⇒ trả mốc cao hơn, không bao giờ trả giá trị thấp hơn', async () => {
        prisma.conversation.findUnique.mockResolvedValue(
          conversationRow({ buyerLastReadAt: T3, lastMessageAt: T2 }),
        );
        prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

        const result = await markRead(buyerActor);

        expect(result.readAt).toBe(T3.toISOString());
      });

      it('mốc cũ hơn ⇒ nhích lên lastMessageAt và đẩy sự kiện', async () => {
        prisma.conversation.findUnique.mockResolvedValue(
          conversationRow({ buyerLastReadAt: T1 }),
        );

        const result = await markRead(buyerActor);

        expect(result.readAt).toBe(T2.toISOString());
        expect(realtime.emitted).toHaveLength(1);
      });

      it('mốc dùng lastMessageAt của hội thoại, KHÔNG dùng đồng hồ của API (lệch đồng hồ hay tin đang chờ commit không làm mốc "ăn" tin chưa tới)', async () => {
        jest.useFakeTimers({ now: new Date('2099-01-01T00:00:00.000Z') });

        const result = await markRead(buyerActor);

        expect(result.readAt).toBe(T2.toISOString());
        expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { buyerLastReadAt: T2 } }),
        );
      });
    });

    describe('hội thoại chưa có tin', () => {
      beforeEach(() => {
        prisma.conversation.findUnique.mockResolvedValue(
          conversationRow({ lastMessageAt: null }),
        );
      });

      it('không ghi gì và KHÔNG đẩy sự kiện (đối phương chưa hề thấy hội thoại này tồn tại)', async () => {
        await markRead(buyerActor);

        expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
        expect(realtime.emitted).toEqual([]);
      });

      it('trả về mốc hiện có, hoặc thời điểm tạo hội thoại nếu chưa có', async () => {
        await expect(markRead(buyerActor)).resolves.toEqual({
          readAt: CREATED.toISOString(),
        });

        prisma.conversation.findUnique.mockResolvedValue(
          conversationRow({ lastMessageAt: null, buyerLastReadAt: T1 }),
        );
        await expect(markRead(buyerActor)).resolves.toEqual({
          readAt: T1.toISOString(),
        });
      });
    });

    describe('đẩy real-time lỗi', () => {
      it('không làm hỏng việc đánh dấu: mốc đã ghi, vẫn trả kết quả, lỗi chỉ được ghi log (không kèm nội dung/nhận diện)', async () => {
        const logged = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        realtime.failWith(new Error('socket down'));

        const result = await markRead(buyerActor);

        expect(result).toEqual({ readAt: T2.toISOString() });
        expect(logged).toHaveBeenCalledTimes(1);
        const message = String(logged.mock.calls[0][0]);
        expect(message).toContain(CONVERSATION_ID);
        expect(message).toContain('socket down');
        expect(message).not.toContain(OWNER);
        expect(message).not.toContain(BUYER);
      });
    });
  });

  describe('unreadCount', () => {
    it('người mua: MỘT truy vấn nhóm theo userId của người gọi, đọc mốc đã đọc của NGƯỜI MUA', async () => {
      prisma.$queryRaw.mockResolvedValue([{ total: 7 }]);

      const result = await service.unreadCount(buyerActor);

      expect(result).toEqual({ unreadCount: 7 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [query] = prisma.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(query.values).toEqual([BUYER]);
      expect(query.sql).toContain('c.buyer_id =');
      expect(query.sql).toContain('c.buyer_last_read_at');
      expect(query.sql).not.toContain('c.shop_last_read_at');
      expect(directory.getShopForChat).not.toHaveBeenCalled();
    });

    it('chủ shop: xác nhận sở hữu với DB rồi đếm theo shopId LẤY TỪ DB, đọc mốc đã đọc của SHOP', async () => {
      prisma.$queryRaw.mockResolvedValue([{ total: 4 }]);
      directory.getShopForChat.mockResolvedValue(
        shopInfo({ id: 'shop-from-db' }),
      );

      const result = await service.unreadCount({
        ...shopActor,
        shopId: 'shop-from-db',
      });

      expect(result).toEqual({ unreadCount: 4 });
      const [query] = prisma.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(query.values).toEqual(['shop-from-db']);
      expect(query.sql).toContain('c.shop_id =');
      expect(query.sql).toContain('c.shop_last_read_at');
      expect(query.sql).not.toContain('c.buyer_last_read_at');
    });

    it.each([
      ['shop không tồn tại', null],
      ['người gọi không phải chủ shop', shopInfo({ ownerId: 'someone-else' })],
    ])('chủ shop: %s ⇒ 404 và không đếm', async (_n, shop) => {
      directory.getShopForChat.mockResolvedValue(shop);

      await expect(service.unreadCount(shopActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('shop KHÔNG còn APPROVED vẫn đếm được', async () => {
      directory.getShopForChat.mockResolvedValue(
        shopInfo({ status: ShopStatus.SUSPENDED }),
      );
      prisma.$queryRaw.mockResolvedValue([{ total: 2 }]);

      await expect(service.unreadCount(shopActor)).resolves.toEqual({
        unreadCount: 2,
      });
    });

    it('không có dòng nào ⇒ 0', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.unreadCount(buyerActor)).resolves.toEqual({
        unreadCount: 0,
      });
    });

    it('lỗi DB được ném tiếp (không nuốt thành 0 — huy hiệu sai còn tệ hơn lỗi rõ ràng)', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('db down'));

      await expect(service.unreadCount(buyerActor)).rejects.toThrow('db down');
    });
  });
});
