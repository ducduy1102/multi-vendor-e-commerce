import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { encodeNotificationCursor } from './notification-cursor';
import { NotificationInboxService } from './notification-inbox.service';

// Phía ĐỌC của thông báo với Prisma giả (Week10.md 7.6): chứng minh mọi truy vấn đều gắn với userId của người gọi, thứ tự và
// con trỏ đúng, và id lạ cho cùng một 404. Hành vi trên Postgres thật (đồng thời, ranh giới trang, chỉ mục) ở
// notification.controller.int-spec.ts.
const USER = 'user-1';
const ORDER_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const idOf = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: idOf(n),
    type: 'ORDER_NEW',
    data: { orderId: ORDER_ID },
    readAt: null,
    createdAt: new Date(Date.UTC(2030, 0, 1, 12, 0, 60 - n)),
    ...overrides,
  };
}

describe('NotificationInboxService', () => {
  let service: NotificationInboxService;
  const prisma = {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const query = (overrides: Record<string, unknown> = {}) => ({
    limit: 20,
    unreadOnly: false,
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.notification.findMany.mockResolvedValue([]);
    service = new NotificationInboxService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('chỉ đọc thông báo CỦA NGƯỜI GỌI, mới nhất trước (createdAt rồi id), select hẹp, lấy thừa 1 dòng', async () => {
      await service.list(USER, query({ limit: 5 }));

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
        select: {
          id: true,
          type: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      });
    });

    it('unreadOnly: thêm điều kiện read_at IS NULL, vẫn gắn userId', async () => {
      await service.list(USER, query({ unreadOnly: true }));

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, readAt: null } }),
      );
    });

    it('có con trỏ: lấy các dòng SAU nó theo (createdAt, id), id là khoá phụ', async () => {
      const at = new Date('2030-01-01T11:59:30.000Z');
      const cursor = encodeNotificationCursor({ at, id: idOf(30) });

      await service.list(USER, query({ cursor }));

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER,
            OR: [
              { createdAt: { lt: at } },
              { createdAt: at, id: { lt: idOf(30) } },
            ],
          },
        }),
      );
    });

    it('còn trang sau: trả đúng `limit` dòng và con trỏ trỏ vào dòng CUỐI TRANG (không phải dòng thừa)', async () => {
      prisma.notification.findMany.mockResolvedValue([row(1), row(2), row(3)]);

      const result = await service.list(USER, query({ limit: 2 }));

      expect(result.items.map((n) => n.id)).toEqual([idOf(1), idOf(2)]);
      expect(result.nextCursor).toBe(
        encodeNotificationCursor({ at: row(2).createdAt, id: idOf(2) }),
      );
    });

    it('hết dữ liệu (không lấy thừa được dòng nào): nextCursor null', async () => {
      prisma.notification.findMany.mockResolvedValue([row(1), row(2)]);

      const result = await service.list(USER, query({ limit: 2 }));

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('danh sách rỗng', async () => {
      await expect(service.list(USER, query())).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('trả thông báo đúng hình dạng API: readAt/createdAt là chuỗi ISO, không lộ userId', async () => {
      prisma.notification.findMany.mockResolvedValue([
        row(1, { readAt: new Date('2030-01-01T13:00:00.000Z') }),
      ]);

      const { items } = await service.list(USER, query());

      expect(items[0]).toEqual({
        id: idOf(1),
        type: 'ORDER_NEW',
        data: { orderId: ORDER_ID },
        readAt: '2030-01-01T13:00:00.000Z',
        createdAt: '2030-01-01T12:00:59.000Z',
      });
      expect(JSON.stringify(items)).not.toContain(USER);
    });

    it('hàng có loại lạ hoặc dữ liệu hỏng KHÔNG làm hỏng trang: rơi về UNKNOWN với data rỗng, dữ liệu lạ không ra ngoài', async () => {
      prisma.notification.findMany.mockResolvedValue([
        row(1),
        row(2, { type: 'PROMO_BLAST', data: { url: 'https://evil.example' } }),
        row(3, { data: { orderId: 'không-phải-uuid' } }),
      ]);

      const { items } = await service.list(USER, query());

      expect(items.map((n) => n.type)).toEqual([
        'ORDER_NEW',
        'UNKNOWN',
        'UNKNOWN',
      ]);
      expect(JSON.stringify(items)).not.toContain('evil.example');
    });

    it.each([[''], ['hỏng'], ['A'.repeat(130)]])(
      'con trỏ %j ⇒ 400, không truy vấn',
      async (cursor) => {
        await expect(
          service.list(USER, query({ cursor })),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.notification.findMany).not.toHaveBeenCalled();
      },
    );

    it.each([[0], [-1], [51], [1.5], [Number.NaN]])(
      'limit %s ⇒ 400, không truy vấn (service không tin nơi gọi)',
      async (limit) => {
        await expect(
          service.list(USER, query({ limit })),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.notification.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('unreadCount', () => {
    it('đếm CHÍNH XÁC các thông báo chưa đọc CỦA NGƯỜI GỌI', async () => {
      prisma.notification.count.mockResolvedValue(7);

      await expect(service.unreadCount(USER)).resolves.toEqual({
        unreadCount: 7,
      });

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: USER, readAt: null },
      });
    });
  });

  describe('markRead', () => {
    const READ_AT = new Date('2030-01-01T12:30:00.000Z');

    it('UPDATE có điều kiện (đúng id, đúng chủ, CHƯA đọc) rồi đọc lại mốc thật, cũng giới hạn theo chủ', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      prisma.notification.findFirst.mockResolvedValue({ readAt: READ_AT });

      const result = await service.markRead(USER, idOf(1));

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: idOf(1), userId: USER, readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: idOf(1), userId: USER },
        select: { readAt: true },
      });
      expect(result).toEqual({ readAt: '2030-01-01T12:30:00.000Z' });
    });

    it('IDEMPOTENT: đã đọc từ trước (UPDATE khớp 0 dòng) ⇒ vẫn thành công và trả ĐÚNG mốc cũ, không ghi đè', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue({ readAt: READ_AT });

      await expect(service.markRead(USER, idOf(1))).resolves.toEqual({
        readAt: '2030-01-01T12:30:00.000Z',
      });
    });

    it.each([
      ['của người khác / không tồn tại', idOf(99)],
      ['id sai dạng', "'; DROP TABLE notifications; --"],
      ['id rỗng', ''],
    ])('%s ⇒ CÙNG một 404', async (_name, id) => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);

      const error: unknown = await service
        .markRead(USER, id)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'Notification not found',
      );
    });
  });

  describe('markAllRead', () => {
    it('chỉ đụng thông báo CHƯA đọc CỦA NGƯỜI GỌI và trả số dòng đã đánh dấu', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      await expect(service.markAllRead(USER)).resolves.toEqual({
        updatedCount: 4,
      });

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it('IDEMPOTENT: không còn gì chưa đọc ⇒ updatedCount 0', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAllRead(USER)).resolves.toEqual({
        updatedCount: 0,
      });
    });
  });
});
