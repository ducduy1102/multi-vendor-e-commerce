import { NotFoundException } from '@nestjs/common';
import { ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { RefundService } from '../order/refund.service';
import { AdminShopOrdersService } from './admin-shop-orders.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_ID = '22222222-2222-4222-8222-222222222222';
const REASON = 'Shop bị khoá, hủy các đơn chưa giao.';
const IDS = [
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003',
];

interface SetupOptions {
  // Hàng shop trả về lần đọc đầu (null = không tồn tại).
  shop?: { status: string } | null;
  // Số đơn mở lần lượt trả về cho từng lần đếm (đầu: matched, cuối: remaining).
  counts?: number[];
  orders?: { id: string }[];
  // Trạng thái shop ở từng lần kiểm giữa các đơn (mặc định luôn SUSPENDED).
  suspendedChecks?: boolean[];
}

// Bản ghi lần gọi thứ `index` của `record` (đối số thứ hai: entry nhật ký).
const auditEntryAt = (record: jest.Mock, index: number) =>
  (record.mock.calls as unknown[][])[index][1];

function setup({
  shop = { status: 'SUSPENDED' },
  counts = [3, 0],
  orders = IDS.map((id) => ({ id })),
  suspendedChecks = [],
}: SetupOptions = {}) {
  const remainingChecks = [...suspendedChecks];
  const countQueue = [...counts];
  const prisma = {
    shop: {
      findUnique: jest.fn().mockImplementation(() => {
        // Lần đầu (assertShopSuspended) trả `shop`; các lần sau là isSuspended giữa các đơn.
        if (prisma.shop.findUnique.mock.calls.length === 1)
          return Promise.resolve(shop);
        const next =
          remainingChecks.length > 0 ? remainingChecks.shift() : true;
        return Promise.resolve({ status: next ? 'SUSPENDED' : 'APPROVED' });
      }),
    },
    order: {
      count: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            countQueue.length > 1 ? countQueue.shift() : countQueue[0],
          ),
        ),
      findMany: jest.fn().mockResolvedValue(orders),
    },
  };
  const refundService = {
    cancelOrderWithRefund: jest.fn().mockResolvedValue({ refund: null }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminShopOrdersService(
    prisma as unknown as PrismaService,
    refundService as unknown as RefundService,
    auditService,
  );
  return { service, prisma, refundService, auditService };
}

const run = (service: AdminShopOrdersService, shopId = SHOP_ID, context = {}) =>
  service.cancelOpenOrders(ADMIN_ID, shopId, { reason: REASON }, context);

describe('AdminShopOrdersService.cancelOpenOrders', () => {
  describe('điều kiện đầu vào', () => {
    it('id sai dạng (kể cả có NUL) và shop không tồn tại: cùng một 404, không chạm DB đơn hàng', async () => {
      const bad = setup();
      await expect(run(bad.service, 'x\u0000y')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(bad.prisma.shop.findUnique).not.toHaveBeenCalled();

      const missing = setup({ shop: null });
      await expect(run(missing.service)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(missing.prisma.order.count).not.toHaveBeenCalled();
      expect(
        missing.refundService.cancelOrderWithRefund,
      ).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'APPROVED', 'REJECTED'])(
      'shop %s (không phải SUSPENDED): 409 SHOP_NOT_SUSPENDED, không đếm, không ghi nhật ký, không hủy đơn nào',
      async (status) => {
        const { service, prisma, refundService, auditService } = setup({
          shop: { status },
        });

        await expectAppException(run(service), {
          status: 409,
          code: 'SHOP_NOT_SUSPENDED',
        });

        expect(prisma.order.count).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
        expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
      },
    );

    it('shop bị khoá nhưng không còn đơn chưa giao: trả kết quả rỗng, KHÔNG ghi nhật ký (không có việc gì để ghi)', async () => {
      const { service, refundService, auditService } = setup({ counts: [0] });

      await expect(run(service)).resolves.toEqual({
        cancelled: 0,
        failed: [],
        needsManualRefund: [],
        refundsPending: 0,
        remaining: 0,
      });
      expect(auditService.record).not.toHaveBeenCalled();
      expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
    });
  });

  describe('chọn đơn', () => {
    it('chỉ đơn PENDING/CONFIRMED/PACKED CỦA SHOP NÀY, cũ nhất trước, tối đa một lô', async () => {
      const { service, prisma } = setup();

      await run(service);

      const where = {
        shopId: SHOP_ID,
        status: { in: ['PENDING', 'CONFIRMED', 'PACKED'] },
      };
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE,
        select: { id: true },
      });
      expect(prisma.order.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('hủy từng đơn', () => {
    it('gọi cancelOrderWithRefund TUẦN TỰ với actor ADMIN và đúng lý do, đếm số đơn hủy được', async () => {
      const { service, refundService } = setup();
      let running = 0;
      let maxParallel = 0;
      refundService.cancelOrderWithRefund.mockImplementation(async () => {
        running += 1;
        maxParallel = Math.max(maxParallel, running);
        await Promise.resolve();
        running -= 1;
        return { refund: null };
      });

      const result = await run(service);

      expect(result.cancelled).toBe(3);
      expect(maxParallel).toBe(1);
      expect(refundService.cancelOrderWithRefund.mock.calls).toEqual(
        IDS.map((id) => [
          { type: 'ADMIN', id: ADMIN_ID },
          id,
          { reason: REASON },
        ]),
      );
    });

    it('đơn thanh toán online: khoản hoàn FAILED ⇒ needsManualRefund; PENDING ⇒ chỉ đếm refundsPending; SUCCEEDED / không có khoản hoàn ⇒ không báo gì', async () => {
      const { service, refundService, auditService } = setup();
      refundService.cancelOrderWithRefund
        .mockResolvedValueOnce({
          refund: { id: 'r1', status: 'FAILED', amount: '220000' },
        })
        .mockResolvedValueOnce({
          refund: { id: 'r2', status: 'PENDING', amount: '100000' },
        })
        .mockResolvedValueOnce({
          refund: { id: 'r3', status: 'SUCCEEDED', amount: '50000' },
        });

      const result = await run(service);

      expect(result.cancelled).toBe(3);
      expect(result.needsManualRefund).toEqual([
        { orderId: IDS[0], refundId: 'r1', amount: '220000' },
      ]);
      expect(result.refundsPending).toBe(1);
      // Dòng nhật ký FINISHED mang đúng các số đếm đó.
      expect(auditEntryAt(auditService.record, 1)).toMatchObject({
        meta: {
          phase: 'FINISHED',
          cancelled: 3,
          failed: 0,
          needsManualRefund: 1,
          refundsPending: 1,
        },
      });
    });

    it('một đơn lỗi KHÔNG chặn các đơn sau: mã nghiệp vụ đi vào failed, lỗi lạ thành UNKNOWN (không lộ thông điệp gốc)', async () => {
      const { service, refundService, auditService } = setup();
      refundService.cancelOrderWithRefund
        .mockRejectedValueOnce(
          new AppException(409, 'ORDER_INVALID_TRANSITION', 'status SHIPPING'),
        )
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'))
        .mockResolvedValueOnce({ refund: null });

      const result = await run(service);

      expect(result.cancelled).toBe(1);
      expect(result.failed).toEqual([
        { orderId: IDS[0], code: 'ORDER_INVALID_TRANSITION' },
        { orderId: IDS[1], code: 'UNKNOWN' },
      ]);
      expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
      expect(auditEntryAt(auditService.record, 1)).toMatchObject({
        meta: { phase: 'FINISHED', matched: 3, cancelled: 1, failed: 2 },
      });
      expect(refundService.cancelOrderWithRefund).toHaveBeenCalledTimes(3);
    });

    it('Admin khác mở lại shop giữa chừng: dừng ngay, không hủy các đơn còn lại', async () => {
      const { service, refundService } = setup({
        counts: [3, 2],
        // Lần kiểm trước đơn 1: còn khoá; trước đơn 2: đã mở lại.
        suspendedChecks: [true, false],
      });

      const result = await run(service);

      expect(refundService.cancelOrderWithRefund).toHaveBeenCalledTimes(1);
      expect(result.cancelled).toBe(1);
      expect(result.remaining).toBe(2);
    });

    it('remaining lấy từ lần đếm CUỐI (đơn lỗi và đơn vượt giới hạn một lô vẫn còn)', async () => {
      const { service } = setup({ counts: [45, 25] });

      const result = await run(service);

      expect(result.remaining).toBe(25);
    });
  });

  describe('nhật ký quản trị', () => {
    it('ghi dòng STARTED TRƯỚC khi hủy đơn đầu tiên, rồi dòng FINISHED kèm số đếm, cùng IP / User-Agent', async () => {
      const { service, refundService, auditService } = setup();
      const order: string[] = [];
      auditService.record.mockImplementation(
        (_client: unknown, entry: { meta: { phase: string } }) => {
          order.push(`audit:${entry.meta.phase}`);
          return Promise.resolve();
        },
      );
      refundService.cancelOrderWithRefund.mockImplementation(() => {
        order.push('cancel');
        return Promise.resolve({ refund: null });
      });

      await run(service, SHOP_ID, { ip: '203.0.113.7', userAgent: 'jest' });

      expect(order).toEqual([
        'audit:STARTED',
        'cancel',
        'cancel',
        'cancel',
        'audit:FINISHED',
      ]);
      const entries = (auditService.record.mock.calls as unknown[][]).map(
        (call) => call[1] as Record<string, unknown>,
      );
      expect(entries[0]).toMatchObject({
        actorId: ADMIN_ID,
        action: 'CANCEL_SHOP_OPEN_ORDERS',
        targetType: 'SHOP',
        targetId: SHOP_ID,
        reason: REASON,
        meta: { phase: 'STARTED', matched: 3 },
        ip: '203.0.113.7',
        userAgent: 'jest',
      });
      expect(entries[1]).toMatchObject({
        meta: {
          phase: 'FINISHED',
          matched: 3,
          cancelled: 3,
          failed: 0,
          needsManualRefund: 0,
          refundsPending: 0,
        },
      });
    });

    it('không ghi được dòng STARTED ⇒ KHÔNG hủy đơn nào (fail-closed) và lỗi được ném ra', async () => {
      const { service, refundService, auditService } = setup();
      auditService.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(run(service)).rejects.toThrow('audit down');

      expect(refundService.cancelOrderWithRefund).not.toHaveBeenCalled();
    });

    it('ghi dòng FINISHED lỗi ⇒ vẫn trả kết quả (việc đã làm xong, không biến thành 500)', async () => {
      const { service, auditService } = setup();
      auditService.record
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(run(service)).resolves.toMatchObject({ cancelled: 3 });
    });
  });
});
