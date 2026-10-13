import { Prisma } from '@prisma/client';
import {
  adminRefundListResponseSchema,
  adminRefundRequestListResponseSchema,
  adminRefundablePaymentListResponseSchema,
} from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { REFUND_PENDING_STALE_MS } from './refund-config';
import { RefundQueryService } from './refund-query.service';

const D = (value: number) => new Prisma.Decimal(value);
const NOW = new Date('2026-10-10T12:00:00.000Z');

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  kind: 'RETURN',
  status: 'ESCALATED',
  reasonCode: 'DAMAGED',
  reasonNote: 'Vỡ góc hộp',
  sellerRespondBy: new Date('2026-10-08T10:00:00.000Z'),
  statusChangedAt: new Date('2026-10-09T10:00:00.000Z'),
  createdAt: new Date('2026-10-07T10:00:00.000Z'),
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: new Date('2026-10-07T10:00:00.000Z'),
    },
  ],
  shop: { id: 'shop-1', name: 'Shop A' },
  user: { name: 'Nguyễn Văn A', email: 'a@example.com' },
  order: {
    id: 'o1',
    status: 'COMPLETED',
    totalAmount: D(320_000),
    recipientName: 'Nguyễn Văn A',
    items: [
      {
        productName: 'Áo',
        variantLabel: 'Đỏ / M',
        sku: 'SKU-1',
        imageUrl: null,
        quantity: 2,
        priceAtPurchase: D(150_000),
      },
    ],
    _count: { items: 1 },
    checkoutGroup: { payments: [{ method: 'VNPAY', status: 'SUCCESS' }] },
    paymentRefund: null,
  },
  ...overrides,
});

const refundRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ref-1',
  status: 'FAILED',
  amount: D(320_000),
  attempts: 3,
  reason: 'Đồng ý trả hàng',
  failureReason: 'Gateway said no',
  gatewayRef: null,
  initiatedByType: 'ADMIN',
  createdAt: new Date('2026-10-09T10:00:00.000Z'),
  updatedAt: new Date('2026-10-09T10:05:00.000Z'),
  completedAt: null,
  payment: {
    id: 'p1',
    method: 'VNPAY',
    status: 'SUCCESS',
    amount: D(320_000),
    refundedAmount: D(0),
    txnRef: 'TXN-1',
    transactionId: 'GW-1',
    checkoutGroup: {
      user: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    },
  },
  order: {
    id: 'o1',
    status: 'REFUNDED',
    totalAmount: D(320_000),
    recipientName: 'Nguyễn Văn A',
  },
  ...overrides,
});

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p2',
  method: 'VNPAY',
  amount: D(320_000),
  paidAt: new Date('2026-10-09T10:30:00.000Z'),
  txnRef: 'TXN-2',
  transactionId: 'GW-2',
  checkoutGroupId: 'g1',
  checkoutGroup: {
    user: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    payments: [
      {
        id: 'p2',
        status: 'SUCCESS',
        method: 'VNPAY',
        paidAt: new Date('2026-10-09T10:30:00.000Z'),
      },
    ],
    orders: [{ id: 'o9', status: 'CANCELLED', totalAmount: D(320_000) }],
  },
  ...overrides,
});

describe('RefundQueryService', () => {
  let service: RefundQueryService;
  let prisma: {
    refundRequest: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    paymentRefund: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    payment: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    prisma = {
      refundRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      paymentRefund: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new RefundQueryService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listRefundRequests', () => {
    const query = (status: string, page = 1, limit = 20) =>
      ({ status, page, limit }) as Parameters<
        RefundQueryService['listRefundRequests']
      >[0];

    it('lọc đúng trạng thái, phân trang theo page/limit, đếm cùng điều kiện', async () => {
      await service.listRefundRequests(query('ESCALATED', 3, 10));

      expect(prisma.refundRequest.count).toHaveBeenCalledWith({
        where: { status: 'ESCALATED' },
      });
      expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ESCALATED' },
          skip: 20,
          take: 10,
        }),
      );
    });

    it.each(['ESCALATED', 'PENDING_SELLER'])(
      'hàng chờ %s: CŨ NHẤT TRƯỚC theo lúc vào trạng thái đó (statusChangedAt)',
      async (status) => {
        await service.listRefundRequests(query(status));

        expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ statusChangedAt: 'asc' }, { id: 'asc' }],
          }),
        );
      },
    );

    it.each(['APPROVED', 'REJECTED', 'REJECTED_BY_SELLER', 'WITHDRAWN'])(
      'trạng thái đã xong %s: MỚI NHẤT TRƯỚC',
      async (status) => {
        await service.listRefundRequests(query(status));

        expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ statusChangedAt: 'desc' }, { id: 'desc' }],
          }),
        );
      },
    );

    it('KHÔNG select actorId của lịch sử (Admin cũng chỉ cần loại người thực hiện)', async () => {
      await service.listRefundRequests(query('ESCALATED'));

      const [args] = prisma.refundRequest.findMany.mock.calls[0] as [
        { select: { history: { select: Record<string, boolean> } } },
      ];
      expect(args.select.history.select).not.toHaveProperty('actorId');
    });

    it('ánh xạ đủ trường: tiền là chuỗi, ngày ISO, người mua, shop, cờ Admin, tóm tắt đơn; response parse được bằng Zod schema dùng chung', async () => {
      prisma.refundRequest.count.mockResolvedValue(1);
      prisma.refundRequest.findMany.mockResolvedValue([requestRow()]);

      const result = await service.listRefundRequests(query('ESCALATED'));

      expect(() =>
        adminRefundRequestListResponseSchema.parse(result),
      ).not.toThrow();
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'req-1',
        kind: 'RETURN',
        status: 'ESCALATED',
        sellerRespondBy: '2026-10-08T10:00:00.000Z',
        statusChangedAt: '2026-10-09T10:00:00.000Z',
        canApprove: true,
        canReject: true,
        shop: { id: 'shop-1', name: 'Shop A' },
        buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
        order: {
          id: 'o1',
          totalAmount: '320000',
          itemCount: 1,
          paymentMethod: 'VNPAY',
          paymentStatus: 'SUCCESS',
          refund: null,
        },
      });
      expect(result.items[0].order.items[0].priceAtPurchase).toBe('150000');
    });

    it('cờ Admin theo bảng chuyển: yêu cầu đã xong ⇒ cả hai cờ tắt', async () => {
      prisma.refundRequest.findMany.mockResolvedValue([
        requestRow({ status: 'APPROVED' }),
        requestRow({ status: 'PENDING_SELLER' }),
      ]);

      const result = await service.listRefundRequests(query('APPROVED'));

      expect(
        result.items.map((item) => [item.canApprove, item.canReject]),
      ).toEqual([
        [false, false],
        [true, true],
      ]);
    });

    it('đơn đã có khoản hoàn ⇒ trả tóm tắt trạng thái + số tiền', async () => {
      const row = requestRow();
      row.order.paymentRefund = {
        status: 'PENDING',
        amount: D(320_000),
      } as never;
      prisma.refundRequest.findMany.mockResolvedValue([row]);

      const result = await service.listRefundRequests(query('ESCALATED'));

      expect(result.items[0].order.refund).toEqual({
        status: 'PENDING',
        amount: '320000',
      });
    });
  });

  describe('getRefundRequest', () => {
    it('không tồn tại ⇒ 404 REFUND_REQUEST_NOT_FOUND', async () => {
      await expectAppException(service.getRefundRequest('req-x'), {
        status: 404,
        code: 'REFUND_REQUEST_NOT_FOUND',
      });
    });

    it('đọc theo id (không giới hạn shop) và ánh xạ', async () => {
      prisma.refundRequest.findUnique.mockResolvedValue(requestRow());

      const result = await service.getRefundRequest('req-1');

      expect(prisma.refundRequest.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1' } }),
      );
      expect(result.id).toBe('req-1');
    });
  });

  describe('listRefunds', () => {
    const query = (status: string, page = 1, limit = 20) =>
      ({ status, page, limit }) as Parameters<
        RefundQueryService['listRefunds']
      >[0];
    const staleCutoff = () => new Date(NOW.getTime() - REFUND_PENDING_STALE_MS);

    it('NEEDS_ACTION = FAILED + PENDING bị bỏ dở (updatedAt <= now − 5 phút, biên bao gồm như cờ canRetry), cũ nhất trước', async () => {
      await service.listRefunds(query('NEEDS_ACTION'));

      const expected = {
        OR: [
          { status: 'FAILED' },
          { status: 'PENDING', updatedAt: { lte: staleCutoff() } },
        ],
      };
      expect(prisma.paymentRefund.count).toHaveBeenCalledWith({
        where: expected,
      });
      expect(prisma.paymentRefund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expected,
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it.each(['PENDING', 'FAILED'])(
      'lọc đúng trạng thái %s, cũ nhất trước',
      async (status) => {
        await service.listRefunds(query(status, 2, 5));

        expect(prisma.paymentRefund.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { status },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            skip: 5,
            take: 5,
          }),
        );
      },
    );

    it('SUCCEEDED (lịch sử): MỚI NHẤT TRƯỚC', async () => {
      await service.listRefunds(query('SUCCEEDED'));

      expect(prisma.paymentRefund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'SUCCEEDED' },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('ánh xạ đủ trường + cờ canRetry/canMarkCompleted; response parse được bằng Zod schema dùng chung', async () => {
      prisma.paymentRefund.count.mockResolvedValue(2);
      prisma.paymentRefund.findMany.mockResolvedValue([
        refundRow(),
        refundRow({
          id: 'ref-2',
          status: 'PENDING',
          failureReason: null,
          order: null,
          // 10 phút trước ⇒ bỏ dở
          updatedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        }),
      ]);

      const result = await service.listRefunds(query('NEEDS_ACTION'));

      expect(() => adminRefundListResponseSchema.parse(result)).not.toThrow();
      expect(result.items[0]).toMatchObject({
        id: 'ref-1',
        status: 'FAILED',
        amount: '320000',
        attempts: 3,
        failureReason: 'Gateway said no',
        canRetry: true,
        canMarkCompleted: true,
        payment: {
          id: 'p1',
          refundedAmount: '0',
          txnRef: 'TXN-1',
          transactionId: 'GW-1',
        },
        order: { id: 'o1', status: 'REFUNDED' },
        buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
      });
      // Hoàn thanh toán bất thường không gắn đơn.
      expect(result.items[1].order).toBeNull();
      expect(result.items[1]).toMatchObject({ canRetry: true });
    });

    it('PENDING còn mới (lần gọi cổng có thể vẫn đang chạy) và SUCCEEDED ⇒ cờ tắt', async () => {
      prisma.paymentRefund.findMany.mockResolvedValue([
        refundRow({
          status: 'PENDING',
          updatedAt: new Date(NOW.getTime() - 60 * 1000),
        }),
        refundRow({ status: 'SUCCEEDED', completedAt: NOW }),
      ]);

      const result = await service.listRefunds(query('PENDING'));

      expect(
        result.items.map((item) => [item.canRetry, item.canMarkCompleted]),
      ).toEqual([
        [false, false],
        [false, false],
      ]);
      expect(result.items[1].completedAt).toBe(NOW.toISOString());
    });
  });

  describe('getRefund', () => {
    it('không tồn tại ⇒ 404 PAYMENT_REFUND_NOT_FOUND', async () => {
      await expectAppException(service.getRefund('ref-x'), {
        status: 404,
        code: 'PAYMENT_REFUND_NOT_FOUND',
      });
    });

    it('đọc theo id và ánh xạ', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(refundRow());

      const result = await service.getRefund('ref-1');

      expect(result).toMatchObject({ id: 'ref-1', status: 'FAILED' });
    });
  });

  describe('listRefundablePayments', () => {
    const query = (page = 1, limit = 20) => ({ page, limit });

    // Hai truy vấn SQL thô chạy song song: danh sách id rồi đếm.
    function rawResults(ids: string[], count: bigint) {
      prisma.$queryRaw
        .mockResolvedValueOnce(ids.map((id) => ({ id })))
        .mockResolvedValueOnce([{ count }]);
    }

    it('không có gì ⇒ rỗng, không đọc chi tiết Payment', async () => {
      rawResults([], BigInt(0));

      const result = await service.listRefundablePayments(query());

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('phân loại lại bằng classifyAbnormalPayment (PAID_AFTER_EXPIRY), tổng lấy từ truy vấn đếm, response parse được bằng Zod schema dùng chung', async () => {
      rawResults(['p2'], BigInt(7));
      prisma.payment.findMany.mockResolvedValue([paymentRow()]);

      const result = await service.listRefundablePayments(query(2, 1));

      expect(() =>
        adminRefundablePaymentListResponseSchema.parse(result),
      ).not.toThrow();
      expect(result).toMatchObject({ total: 7, page: 2, limit: 1 });
      expect(result.items[0]).toMatchObject({
        id: 'p2',
        kind: 'PAID_AFTER_EXPIRY',
        amount: '320000',
        txnRef: 'TXN-2',
        transactionId: 'GW-2',
        checkoutGroupId: 'g1',
        buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
        orders: [{ id: 'o9', status: 'CANCELLED', totalAmount: '320000' }],
      });
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['p2'] } } }),
      );
    });

    it('khoản SUCCESS đến sau trong cùng nhóm ⇒ DUPLICATE', async () => {
      rawResults(['p3'], BigInt(1));
      prisma.payment.findMany.mockResolvedValue([
        paymentRow({
          id: 'p3',
          paidAt: new Date('2026-10-09T11:00:00.000Z'),
          checkoutGroup: {
            user: { name: 'A', email: 'a@example.com' },
            payments: [
              {
                id: 'p2',
                status: 'SUCCESS',
                method: 'VNPAY',
                paidAt: new Date('2026-10-09T10:30:00.000Z'),
              },
              {
                id: 'p3',
                status: 'SUCCESS',
                method: 'VNPAY',
                paidAt: new Date('2026-10-09T11:00:00.000Z'),
              },
            ],
            // Đơn vẫn sống: chỉ riêng việc trả hai lần đã là bất thường.
            orders: [{ id: 'o9', status: 'PENDING', totalAmount: D(1) }],
          },
        }),
      ]);

      const result = await service.listRefundablePayments(query());

      expect(result.items[0].kind).toBe('DUPLICATE');
    });

    it('giữ ĐÚNG thứ tự của truy vấn id (findMany `in` không đảm bảo thứ tự)', async () => {
      rawResults(['pb', 'pa'], BigInt(2));
      // Trả về theo thứ tự KHÁC truy vấn id; mỗi dòng tự phân loại được (nhóm riêng, mọi đơn đã hủy).
      prisma.payment.findMany.mockResolvedValue(
        ['pa', 'pb'].map((id) =>
          paymentRow({
            id,
            checkoutGroup: {
              user: { name: 'A', email: 'a@example.com' },
              payments: [
                { id, status: 'SUCCESS', method: 'VNPAY', paidAt: NOW },
              ],
              orders: [
                { id: `o-${id}`, status: 'CANCELLED', totalAmount: D(1) },
              ],
            },
          }),
        ),
      );

      const result = await service.listRefundablePayments(query());

      expect(result.items.map((item) => item.id)).toEqual(['pb', 'pa']);
    });

    it('khớp bộ lọc SQL nhưng classifyAbnormalPayment cho là bình thường (đơn còn sống) ⇒ bỏ qua dòng đó, không ném', async () => {
      rawResults(['p2'], BigInt(1));
      prisma.payment.findMany.mockResolvedValue([
        paymentRow({
          checkoutGroup: {
            user: { name: 'A', email: 'a@example.com' },
            payments: [
              { id: 'p2', status: 'SUCCESS', method: 'VNPAY', paidAt: NOW },
            ],
            orders: [{ id: 'o9', status: 'PENDING', totalAmount: D(1) }],
          },
        }),
      ]);

      const result = await service.listRefundablePayments(query());

      expect(result.items).toEqual([]);
    });

    it('phân trang SQL: LIMIT/OFFSET theo page/limit', async () => {
      rawResults([], BigInt(0));

      await service.listRefundablePayments(query(3, 5));

      const [listCall, ...values] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(listCall.join('?')).toContain('LIMIT');
      expect(listCall.join('?')).toContain('OFFSET');
      // Tham số cuối của truy vấn danh sách: limit rồi offset.
      expect(values.slice(-2)).toEqual([5, 10]);
    });
  });
});
