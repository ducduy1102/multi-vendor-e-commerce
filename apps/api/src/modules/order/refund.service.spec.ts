import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RefundResult } from '../../shared/payment/payment-gateway.interface';
import type { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { TxClient } from '../../shared/prisma/tx-client';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { InventoryService } from '../product/inventory.service';
import type { VoucherUsageService } from '../voucher/voucher-usage.service';
import type { OrderEmailService } from './order-email.service';
import type { OrderActor, OrderStatusService } from './order-status.service';
import { REFUND_PENDING_STALE_MS } from './refund-config';
import type { RefundRequestService } from './refund-request.service';
import { RefundService } from './refund.service';

const D = (value: number) => new Prisma.Decimal(value);

const BUYER: OrderActor = { type: 'BUYER', id: 'buyer-1' };
const SELLER: OrderActor = { type: 'SELLER', id: 'seller-1' };
const ADMIN: OrderActor = { type: 'ADMIN', id: 'admin-1' };
const SYSTEM: OrderActor = { type: 'SYSTEM' };

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  method: 'VNPAY',
  status: 'SUCCESS',
  paidAt: new Date('2026-10-07T09:00:00.000Z'),
  amount: D(410_000),
  ...overrides,
});

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  status: 'PENDING',
  checkoutGroupId: 'g1',
  totalAmount: D(410_000),
  items: [
    { productVariantId: 'v1', quantity: 2 },
    { productVariantId: 'v2', quantity: 1 },
  ],
  checkoutGroup: { payments: [paymentRow()] },
  ...overrides,
});

describe('RefundService', () => {
  let service: RefundService;
  // Ghi lại thứ tự gọi để kiểm thứ tự khoá: Payment → đơn cả nhóm → variant → voucher.
  let calls: string[];
  // Trạng thái "DB" giả mà các mock đọc/ghi.
  let lockedPayment: { status: string; amount: string } | null;
  let groupRows: { id: string; status: string }[];
  let refundState: { status: string };

  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    order: { findMany: jest.Mock };
    payment: { findMany: jest.Mock; updateMany: jest.Mock };
    refundRequest: { findFirst: jest.Mock };
    paymentRefund: {
      aggregate: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
    };
  };
  let prisma: {
    $transaction: jest.Mock;
    order: { findUnique: jest.Mock };
    payment: { findUnique: jest.Mock };
    paymentRefund: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let orderStatusService: { transition: jest.Mock };
  let inventoryService: { restock: jest.Mock };
  let voucherUsageService: { release: jest.Mock };
  let gateway: { refund: jest.Mock };
  let paymentGateway: { get: jest.Mock };
  let refundRequestService: { transition: jest.Mock };
  let orderEmailService: { notifyCancelled: jest.Mock };

  const gatewayResult = (result: Partial<RefundResult>) =>
    gateway.refund.mockResolvedValue({
      outcome: 'SUCCESS',
      gatewayRef: 'GW-REFUND-1',
      failureReason: null,
      ...result,
    });

  beforeEach(() => {
    calls = [];
    lockedPayment = { status: 'SUCCESS', amount: '410000.00' };
    groupRows = [{ id: 'o1', status: 'PENDING' }];
    refundState = { status: 'PENDING' };

    tx = {
      $queryRaw: jest
        .fn()
        .mockImplementation((strings: TemplateStringsArray) => {
          if (strings.join('?').includes('FROM payments')) {
            calls.push('lockPayment');
            return Promise.resolve(lockedPayment ? [lockedPayment] : []);
          }
          calls.push('lockGroup');
          return Promise.resolve(groupRows);
        }),
      $executeRaw: jest.fn().mockImplementation(() => {
        calls.push('applyToPayment');
        return Promise.resolve(1);
      }),
      order: {
        // Dùng chung cho helper trả voucher (status + discountAmount) và chốt Payment COD (status).
        findMany: jest.fn().mockImplementation(() => {
          calls.push('readGroup');
          return Promise.resolve([
            { status: 'CANCELLED', discountAmount: D(0) },
          ]);
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([paymentRow()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refundRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRefund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
        create: jest.fn().mockImplementation(() => {
          calls.push('createRefund');
          return Promise.resolve({
            id: 'r1',
            status: 'PENDING',
            amount: D(410_000),
          });
        }),
        updateMany: jest
          .fn()
          .mockImplementation(({ data }: { data: { status?: string } }) => {
            if (data.status) refundState.status = data.status;
            return Promise.resolve({ count: 1 });
          }),
        findUniqueOrThrow: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: 'r1',
            status: refundState.status,
            amount: D(410_000),
            updatedAt: new Date(),
          }),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findUnique: jest.fn().mockResolvedValue(orderRow()) },
      payment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'p1', checkoutGroupId: 'g1' }),
      },
      paymentRefund: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: 'r1',
            paymentId: 'p1',
            status: refundState.status,
            amount: D(410_000),
            gatewayRef: null,
            updatedAt: new Date(),
            payment: {
              method: 'VNPAY',
              txnRef: 'TXN-1',
              transactionId: 'GW-TXN-1',
              amount: D(410_000),
            },
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    orderStatusService = {
      transition: jest.fn().mockImplementation(() => {
        calls.push('transition');
        return Promise.resolve(['o1']);
      }),
    };
    inventoryService = {
      restock: jest.fn().mockImplementation(() => {
        calls.push('restock');
        return Promise.resolve();
      }),
    };
    voucherUsageService = {
      release: jest.fn().mockImplementation(() => {
        calls.push('voucherRelease');
        return Promise.resolve(1);
      }),
    };
    gateway = { refund: jest.fn() };
    gatewayResult({});
    paymentGateway = { get: jest.fn().mockReturnValue(gateway) };
    refundRequestService = {
      transition: jest.fn().mockImplementation(() => {
        calls.push('requestTransition');
        return Promise.resolve();
      }),
    };
    orderEmailService = {
      notifyCancelled: jest.fn().mockResolvedValue(undefined),
    };

    service = new RefundService(
      prisma as unknown as PrismaService,
      orderStatusService as unknown as OrderStatusService,
      inventoryService as unknown as InventoryService,
      voucherUsageService as unknown as VoucherUsageService,
      paymentGateway as unknown as PaymentGatewayService,
      refundRequestService as unknown as RefundRequestService,
      orderEmailService as unknown as OrderEmailService,
    );
  });

  afterEach(() => {
    delete process.env.REFUND_GATEWAY_TIMEOUT_MS;
    jest.restoreAllMocks();
  });

  // --- cancelOrderWithRefund: nhánh online -------------------------------------------------------

  describe('cancelOrderWithRefund — đơn đã trả online', () => {
    it('hủy NGAY: Tx1 đúng thứ tự khoá Payment → đơn cả nhóm → lật trạng thái → kho → voucher → sổ cái; rồi gọi cổng và chốt', async () => {
      const result = await service.cancelOrderWithRefund(BUYER, 'o1', {
        reason: 'Đặt nhầm',
      });

      expect(calls).toEqual([
        'lockPayment',
        'lockGroup',
        'transition',
        'restock',
        'readGroup',
        'createRefund',
        // Sau commit Tx1: cổng được gọi NGOÀI transaction rồi Tx2 khoá Payment lại để chốt.
        'lockPayment',
        'applyToPayment',
      ]);
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'PENDING',
        'CANCELLED',
        BUYER,
        'Đặt nhầm',
      );
      expect(result.refund).toEqual({
        id: 'r1',
        status: 'SUCCEEDED',
        amount: '410000',
      });
      // Tx1 và Tx2 là HAI transaction; lời gọi cổng nằm giữa, không trong transaction nào.
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('cộng lại kho đúng từng dòng hàng và tạo PaymentRefund PENDING đúng số tiền của đơn, kèm người khởi tạo', async () => {
      await service.cancelOrderWithRefund(SELLER, 'o1', { reason: 'Hết hàng' });

      expect(inventoryService.restock).toHaveBeenCalledWith(tx, [
        { productVariantId: 'v1', quantity: 2 },
        { productVariantId: 'v2', quantity: 1 },
      ]);
      expect(tx.paymentRefund.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'p1',
          orderId: 'o1',
          refundRequestId: null,
          amount: D(410_000),
          status: 'PENDING',
          reason: 'Hết hàng',
          initiatedByType: 'SELLER',
          initiatedById: 'seller-1',
        },
        select: { id: true, status: true, amount: true },
      });
    });

    it('gọi cổng với mã tham chiếu ỔN ĐỊNH suy từ id khoản hoàn, số tiền nguyên VND và mã giao dịch gốc; tăng attempts trước khi gọi', async () => {
      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(prisma.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'PENDING' },
        data: { attempts: { increment: 1 } },
      });
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(gateway.refund).toHaveBeenCalledWith({
        refundRef: 'r1',
        txnRef: 'TXN-1',
        gatewayTransactionId: 'GW-TXN-1',
        amountVnd: 410_000,
        paymentAmountVnd: 410_000,
        reason: 'Order refund',
      });
    });

    it('hoàn đủ ⇒ chốt SUCCEEDED với mã hoàn của cổng, cộng Payment.refundedAmount bằng MỘT câu UPDATE có điều kiện', async () => {
      gatewayResult({ outcome: 'SUCCESS', gatewayRef: 'GW-REFUND-9' });

      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(tx.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: { in: ['PENDING'] } },
        data: {
          status: 'SUCCEEDED',
          gatewayRef: 'GW-REFUND-9',
          failureReason: null,
          completedAt: expect.any(Date) as Date,
        },
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = (
        tx.$executeRaw.mock.calls[0] as [TemplateStringsArray]
      )[0].join('?');
      expect(sql).toContain('refunded_amount + ?::numeric <= amount');
      expect(sql).toContain('\'REFUNDED\'::"PaymentStatus"');
    });

    it('cổng TỪ CHỐI (FAILED): khoản hoàn FAILED kèm lý do, đơn VẪN bị hủy, kho và voucher đã trả, response vẫn thành công', async () => {
      gatewayResult({
        outcome: 'FAILED',
        gatewayRef: null,
        failureReason: 'Giao dịch gốc không tồn tại',
      });

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund?.status).toBe('FAILED');
      expect(tx.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'PENDING' },
        data: {
          status: 'FAILED',
          failureReason: 'Giao dịch gốc không tồn tại',
        },
      });
      // Không hoàn tác việc hủy: kho đã cộng, không có transaction nào đảo ngược.
      expect(inventoryService.restock).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(orderEmailService.notifyCancelled).toHaveBeenCalledTimes(1);
    });

    it('lý do thất bại dài được cắt còn 500 ký tự (cột VARCHAR(500))', async () => {
      gatewayResult({ outcome: 'FAILED', failureReason: 'x'.repeat(900) });

      await service.cancelOrderWithRefund(BUYER, 'o1');

      const failedCall = tx.paymentRefund.updateMany.mock.calls.find(
        ([arg]: [{ data: { status?: string } }]) =>
          arg.data.status === 'FAILED',
      ) as [{ data: { failureReason: string } }];
      expect(failedCall[0].data.failureReason).toHaveLength(500);
    });

    it('cổng báo PENDING ⇒ giữ PENDING, KHÔNG chốt gì, response vẫn thành công ("đang hoàn tiền")', async () => {
      gatewayResult({ outcome: 'PENDING', gatewayRef: null });

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund).toEqual({
        id: 'r1',
        status: 'PENDING',
        amount: '410000',
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1); // chỉ Tx1
    });

    it('cổng QUÁ HẠN (REFUND_GATEWAY_TIMEOUT_MS) ⇒ PENDING, không treo request', async () => {
      process.env.REFUND_GATEWAY_TIMEOUT_MS = '20';
      gateway.refund.mockReturnValue(new Promise(() => undefined));

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund?.status).toBe('PENDING');
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('cổng ném lỗi bất ngờ (mạng/cấu hình) ⇒ coi là PENDING, không làm hỏng việc hủy', async () => {
      gateway.refund.mockRejectedValue(new Error('socket hang up'));

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund?.status).toBe('PENDING');
      expect(orderEmailService.notifyCancelled).toHaveBeenCalledTimes(1);
    });

    it('lỗi DB khi chốt SAU commit Tx1 không làm fail request: trả khoản hoàn PENDING cho job xử lý tiếp', async () => {
      tx.$executeRaw.mockRejectedValue(new Error('connection lost'));

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund).toEqual({
        id: 'r1',
        status: 'PENDING',
        amount: '410000',
      });
    });

    it('email SAU commit nói "đang hoàn" kèm số tiền; người hủy BUYER và lý do nguyên văn', async () => {
      await service.cancelOrderWithRefund(BUYER, 'o1', { reason: 'Đặt nhầm' });

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'BUYER',
        'Đặt nhầm',
        410_000,
      );
    });

    it('seller hủy/từ chối ⇒ email người hủy SELLER; không có lý do ⇒ null (không chuỗi mặc định)', async () => {
      await service.cancelOrderWithRefund(SELLER, 'o1');

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'SELLER',
        null,
        410_000,
      );
    });

    it.each(['CONFIRMED', 'PACKED'] as const)(
      'đơn %s cũng hủy được (seller tự hủy / duyệt yêu cầu hủy)',
      async (status) => {
        prisma.order.findUnique.mockResolvedValue(orderRow({ status }));
        groupRows = [{ id: 'o1', status }];

        await service.cancelOrderWithRefund(SELLER, 'o1');

        expect(orderStatusService.transition).toHaveBeenCalledWith(
          tx,
          ['o1'],
          status,
          'CANCELLED',
          SELLER,
          undefined,
        );
      },
    );

    it('nhóm có thanh toán trùng: hoàn vào khoản SUCCESS SỚM NHẤT', async () => {
      prisma.order.findUnique.mockResolvedValue(
        orderRow({
          checkoutGroup: {
            payments: [
              paymentRow({
                id: 'late',
                paidAt: new Date('2026-10-07T11:00:00.000Z'),
              }),
              paymentRow({
                id: 'early',
                paidAt: new Date('2026-10-07T09:00:00.000Z'),
              }),
            ],
          },
        }),
      );

      await service.cancelOrderWithRefund(BUYER, 'o1');

      const create = tx.paymentRefund.create.mock.calls[0] as [
        { data: { paymentId: string } },
      ];
      expect(create[0].data.paymentId).toBe('early');
    });

    it('đơn 0đ (voucher phủ hết) ⇒ không có tiền để hoàn: không tạo PaymentRefund, không gọi cổng, vẫn hủy', async () => {
      prisma.order.findUnique.mockResolvedValue(
        orderRow({ totalAmount: D(0) }),
      );

      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund).toBeNull();
      expect(tx.paymentRefund.create).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(orderStatusService.transition).toHaveBeenCalledTimes(1);
      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'BUYER',
        null,
        null,
      );
    });

    describe('bị từ chối — KHÔNG ghi gì', () => {
      it('đơn không tồn tại ⇒ 404 ORDER_NOT_FOUND', async () => {
        prisma.order.findUnique.mockResolvedValue(null);

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'x'), {
          status: 404,
          code: 'ORDER_NOT_FOUND',
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it.each([
        'AWAITING_PAYMENT',
        'SHIPPING',
        'COMPLETED',
        'CANCELLED',
        'REFUNDED',
      ] as const)(
        'đơn %s ⇒ 409 ORDER_INVALID_TRANSITION (SHIPPING không hủy được: hàng đã giao vận chuyển)',
        async (status) => {
          prisma.order.findUnique.mockResolvedValue(orderRow({ status }));

          await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
            status: 409,
            code: 'ORDER_INVALID_TRANSITION',
          });
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      );

      it('nhóm online chưa thu được đồng nào ⇒ 409 PAYMENT_NOT_REFUNDABLE', async () => {
        prisma.order.findUnique.mockResolvedValue(
          orderRow({
            checkoutGroup: { payments: [paymentRow({ status: 'FAILED' })] },
          }),
        );

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
          status: 409,
          code: 'PAYMENT_NOT_REFUNDABLE',
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('Payment không còn SUCCESS sau khi khoá (vd đã hoàn hết) ⇒ 409 PAYMENT_NOT_REFUNDABLE, chưa đụng đơn', async () => {
        lockedPayment = { status: 'REFUNDED', amount: '410000.00' };

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
          status: 409,
          code: 'PAYMENT_NOT_REFUNDABLE',
        });
        expect(orderStatusService.transition).not.toHaveBeenCalled();
      });

      it('đơn đã đổi trạng thái giữa lúc đọc và lúc khoá ⇒ 409 ORDER_INVALID_TRANSITION, chưa lật gì', async () => {
        groupRows = [{ id: 'o1', status: 'SHIPPING' }];

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
          status: 409,
          code: 'ORDER_INVALID_TRANSITION',
        });
        expect(orderStatusService.transition).not.toHaveBeenCalled();
      });

      it('thua race (UPDATE có điều kiện lật 0 đơn) ⇒ 409 ORDER_ALREADY_CHANGED, KHÔNG cộng kho/trả voucher/tạo khoản hoàn', async () => {
        orderStatusService.transition.mockResolvedValue([]);

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
          status: 409,
          code: 'ORDER_ALREADY_CHANGED',
        });
        expect(inventoryService.restock).not.toHaveBeenCalled();
        expect(voucherUsageService.release).not.toHaveBeenCalled();
        expect(tx.paymentRefund.create).not.toHaveBeenCalled();
        expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
        expect(gateway.refund).not.toHaveBeenCalled();
      });

      it('tổng khoản hoàn chưa-FAILED + khoản này vượt số đã thu ⇒ 409 PAYMENT_NOT_REFUNDABLE, không tạo khoản hoàn, không gọi cổng', async () => {
        tx.paymentRefund.aggregate.mockResolvedValue({
          _sum: { amount: D(100_000) },
        });

        await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
          status: 409,
          code: 'PAYMENT_NOT_REFUNDABLE',
        });
        expect(tx.paymentRefund.create).not.toHaveBeenCalled();
        expect(gateway.refund).not.toHaveBeenCalled();
        expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
      });

      it('chỉ tính các khoản hoàn CHƯA FAILED khi kiểm tổng (khoản FAILED được thử lại, không chiếm chỗ)', async () => {
        await service.cancelOrderWithRefund(BUYER, 'o1');

        expect(tx.paymentRefund.aggregate).toHaveBeenCalledWith({
          where: { paymentId: 'p1', status: { not: 'FAILED' } },
          _sum: { amount: true },
        });
      });
    });

    describe('đóng yêu cầu hủy đang mở cùng giao dịch', () => {
      it('seller tự hủy khi buyer đang có yêu cầu hủy PENDING_SELLER ⇒ yêu cầu → APPROVED (actor SELLER), khoản hoàn gắn refundRequestId, email "theo yêu cầu của bạn"', async () => {
        prisma.order.findUnique.mockResolvedValue(
          orderRow({ status: 'CONFIRMED' }),
        );
        groupRows = [{ id: 'o1', status: 'CONFIRMED' }];
        tx.refundRequest.findFirst.mockResolvedValue({
          id: 'req-1',
          status: 'PENDING_SELLER',
        });

        await service.cancelOrderWithRefund(SELLER, 'o1', {
          reason: 'Hết hàng',
        });

        expect(tx.refundRequest.findFirst).toHaveBeenCalledWith({
          where: {
            orderId: 'o1',
            kind: 'CANCEL',
            status: { in: ['PENDING_SELLER', 'ESCALATED'] },
          },
          select: { id: true, status: true },
        });
        expect(refundRequestService.transition).toHaveBeenCalledWith(
          tx,
          'req-1',
          'PENDING_SELLER',
          'APPROVED',
          SELLER,
          'Hết hàng',
        );
        const create = tx.paymentRefund.create.mock.calls[0] as [
          { data: { refundRequestId: string } },
        ];
        expect(create[0].data.refundRequestId).toBe('req-1');
        expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
          { orderIds: ['o1'] },
          'BUYER',
          'Hết hàng',
          410_000,
        );
      });

      it('yêu cầu đã lên sàn (ESCALATED) được seller "nhượng bộ" đóng bằng chính việc tự hủy đơn', async () => {
        prisma.order.findUnique.mockResolvedValue(
          orderRow({ status: 'PACKED' }),
        );
        groupRows = [{ id: 'o1', status: 'PACKED' }];
        tx.refundRequest.findFirst.mockResolvedValue({
          id: 'req-1',
          status: 'ESCALATED',
        });

        await service.cancelOrderWithRefund(SELLER, 'o1');

        expect(refundRequestService.transition).toHaveBeenCalledWith(
          tx,
          'req-1',
          'ESCALATED',
          'APPROVED',
          SELLER,
          null,
        );
      });

      it('yêu cầu được đóng SAU khi tạo khoản hoàn, cùng transaction (đúng thứ tự Tx1)', async () => {
        tx.refundRequest.findFirst.mockResolvedValue({
          id: 'req-1',
          status: 'PENDING_SELLER',
        });

        await service.cancelOrderWithRefund(SYSTEM, 'o1', {
          reason: 'Auto-approved',
        });

        expect(calls.indexOf('createRefund')).toBeLessThan(
          calls.indexOf('requestTransition'),
        );
        expect(refundRequestService.transition).toHaveBeenCalledWith(
          tx,
          'req-1',
          'PENDING_SELLER',
          'APPROVED',
          SYSTEM,
          'Auto-approved',
        );
      });

      it('không có yêu cầu mở ⇒ không đóng gì', async () => {
        await service.cancelOrderWithRefund(BUYER, 'o1');

        expect(refundRequestService.transition).not.toHaveBeenCalled();
      });

      it('duyệt ĐÚNG một yêu cầu (refundRequestId): yêu cầu đã rút/đóng ⇒ 409 và cả giao dịch dừng — đơn không bị hủy oan', async () => {
        tx.refundRequest.findFirst.mockResolvedValue({
          id: 'req-1',
          status: 'WITHDRAWN',
        });

        await expectAppException(
          service.cancelOrderWithRefund(SELLER, 'o1', {
            refundRequestId: 'req-1',
          }),
          { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
        );
        expect(tx.refundRequest.findFirst).toHaveBeenCalledWith({
          where: { id: 'req-1', orderId: 'o1', kind: 'CANCEL' },
          select: { id: true, status: true },
        });
        expect(tx.paymentRefund.create).not.toHaveBeenCalled();
        expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
      });

      it('duyệt ĐÚNG một yêu cầu không thuộc đơn này (không tìm thấy) ⇒ 409', async () => {
        tx.refundRequest.findFirst.mockResolvedValue(null);

        await expectAppException(
          service.cancelOrderWithRefund(SELLER, 'o1', {
            refundRequestId: 'other',
          }),
          { status: 409, code: 'REFUND_REQUEST_INVALID_TRANSITION' },
        );
      });

      it('duyệt đúng yêu cầu còn mở ⇒ chuyển APPROVED với ghi chú của người duyệt', async () => {
        tx.refundRequest.findFirst.mockResolvedValue({
          id: 'req-1',
          status: 'PENDING_SELLER',
        });

        await service.cancelOrderWithRefund(SELLER, 'o1', {
          refundRequestId: 'req-1',
          reason: '  Đồng ý hủy  ',
        });

        expect(refundRequestService.transition).toHaveBeenCalledWith(
          tx,
          'req-1',
          'PENDING_SELLER',
          'APPROVED',
          SELLER,
          'Đồng ý hủy',
        );
      });
    });
  });

  // --- cancelOrderWithRefund: nhánh COD ----------------------------------------------------------

  describe('cancelOrderWithRefund — đơn COD (không có tiền qua cổng)', () => {
    const codOrder = (overrides: Record<string, unknown> = {}) =>
      orderRow({
        checkoutGroup: {
          payments: [
            paymentRow({ method: 'COD', status: 'PENDING', paidAt: null }),
          ],
        },
        ...overrides,
      });

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(codOrder());
    });

    it('KHÔNG khoá Payment, KHÔNG tạo PaymentRefund, KHÔNG gọi cổng; thứ tự đơn cả nhóm → kho → voucher → chốt Payment COD', async () => {
      const result = await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(result.refund).toBeNull();
      expect(calls).toEqual([
        'lockGroup',
        'transition',
        'restock',
        'readGroup', // helper trả voucher đọc cả nhóm
        'readGroup', // settleCodPayment đọc cả nhóm
      ]);
      expect(tx.paymentRefund.create).not.toHaveBeenCalled();
      expect(paymentGateway.get).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('nhóm hủy hết ⇒ Payment COD → CANCELLED (không thu), không kẹt PENDING', async () => {
      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    });

    it('nhóm còn đơn khác đang sống ⇒ Payment COD vẫn PENDING', async () => {
      tx.order.findMany.mockResolvedValue([
        { status: 'CANCELLED', discountAmount: D(0) },
        { status: 'PENDING', discountAmount: D(0) },
      ]);

      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('email báo hủy KHÔNG có đoạn hoàn tiền (refundAmount null)', async () => {
      await service.cancelOrderWithRefund(SELLER, 'o1', { reason: 'Hết hàng' });

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { orderIds: ['o1'] },
        'SELLER',
        'Hết hàng',
        null,
      );
    });

    it('đóng cả yêu cầu hủy đang mở như nhánh online', async () => {
      prisma.order.findUnique.mockResolvedValue(
        codOrder({ status: 'CONFIRMED' }),
      );
      groupRows = [{ id: 'o1', status: 'CONFIRMED' }];
      tx.refundRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_SELLER',
      });

      await service.cancelOrderWithRefund(SELLER, 'o1');

      expect(refundRequestService.transition).toHaveBeenCalledTimes(1);
    });

    it('thua race ⇒ 409 ORDER_ALREADY_CHANGED, không cộng kho, không chốt Payment', async () => {
      orderStatusService.transition.mockResolvedValue([]);

      await expectAppException(service.cancelOrderWithRefund(BUYER, 'o1'), {
        status: 409,
        code: 'ORDER_ALREADY_CHANGED',
      });
      expect(inventoryService.restock).not.toHaveBeenCalled();
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  // --- Trả lượt voucher (Week9.md 1.7) ------------------------------------------------------------

  describe('trả lượt voucher khi hủy', () => {
    const discounted = (status: string, amount: number) => ({
      status,
      discountAmount: D(amount),
    });

    it('mọi đơn hưởng giảm giá đã CANCELLED ⇒ nhả lượt (idempotent theo cả nhóm)', async () => {
      tx.order.findMany.mockResolvedValue([discounted('CANCELLED', 20_000)]);

      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(voucherUsageService.release).toHaveBeenCalledWith(tx, 'g1');
    });

    it('nhóm 2 đơn, hủy 1 đơn, đơn kia vẫn hưởng giảm ⇒ GIỮ lượt', async () => {
      tx.order.findMany.mockResolvedValue([
        discounted('CANCELLED', 10_000),
        discounted('CONFIRMED', 10_000),
      ]);

      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(voucherUsageService.release).not.toHaveBeenCalled();
    });

    it('cuối thứ tự khoá: sau khi cộng kho', async () => {
      tx.order.findMany.mockResolvedValue([discounted('CANCELLED', 20_000)]);

      await service.cancelOrderWithRefund(BUYER, 'o1');

      expect(calls.indexOf('restock')).toBeLessThan(
        calls.indexOf('voucherRelease'),
      );
    });

    it('trả hàng sau giao (REFUNDED) KHÔNG trả lượt và KHÔNG đọc nhóm để xét voucher', async () => {
      prisma.order.findUnique.mockResolvedValue(
        orderRow({ status: 'COMPLETED' }),
      );
      groupRows = [{ id: 'o1', status: 'COMPLETED' }];
      tx.order.findMany.mockResolvedValue([discounted('REFUNDED', 20_000)]);

      await service.refundReturnedOrder(ADMIN, 'o1');

      expect(voucherUsageService.release).not.toHaveBeenCalled();
      expect(inventoryService.restock).not.toHaveBeenCalled();
    });

    it('releaseVoucherIfFullyCancelled trả true khi có lượt được nhả, false khi không', async () => {
      tx.order.findMany.mockResolvedValue([discounted('CANCELLED', 20_000)]);
      voucherUsageService.release.mockResolvedValueOnce(1);
      await expect(
        service.releaseVoucherIfFullyCancelled(tx as unknown as TxClient, 'g1'),
      ).resolves.toBe(true);

      voucherUsageService.release.mockResolvedValueOnce(0); // đã nhả từ trước (idempotent)
      await expect(
        service.releaseVoucherIfFullyCancelled(tx as unknown as TxClient, 'g1'),
      ).resolves.toBe(false);

      tx.order.findMany.mockResolvedValue([discounted('PENDING', 20_000)]);
      await expect(
        service.releaseVoucherIfFullyCancelled(tx as unknown as TxClient, 'g1'),
      ).resolves.toBe(false);
    });
  });

  describe('applyCancellationEffects', () => {
    it('cộng lại stock vật lý (restock, KHÔNG phải release) đúng từng dòng rồi mới xét voucher', async () => {
      await service.applyCancellationEffects(tx as unknown as TxClient, {
        checkoutGroupId: 'g1',
        items: [
          { productVariantId: 'v1', quantity: 3 },
          { productVariantId: 'v2', quantity: 1 },
        ],
      });

      expect(inventoryService.restock).toHaveBeenCalledWith(tx, [
        { productVariantId: 'v1', quantity: 3 },
        { productVariantId: 'v2', quantity: 1 },
      ]);
      expect(calls).toEqual(['restock', 'readGroup']);
    });
  });

  // --- refundReturnedOrder ----------------------------------------------------------------------

  describe('refundReturnedOrder (duyệt trả hàng sau giao)', () => {
    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(
        orderRow({ status: 'COMPLETED' }),
      );
      groupRows = [{ id: 'o1', status: 'COMPLETED' }];
    });

    it('online: COMPLETED → REFUNDED, KHÔNG cộng kho, KHÔNG xét voucher, tạo khoản hoàn và gọi cổng', async () => {
      const result = await service.refundReturnedOrder(ADMIN, 'o1', {
        reason: 'Hàng lỗi đã xác minh',
      });

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'COMPLETED',
        'REFUNDED',
        ADMIN,
        'Hàng lỗi đã xác minh',
      );
      expect(calls).toEqual([
        'lockPayment',
        'lockGroup',
        'transition',
        'createRefund',
        'lockPayment',
        'applyToPayment',
      ]);
      expect(result.refund?.status).toBe('SUCCEEDED');
    });

    it('KHÔNG gửi email "đơn bị hủy" (đơn trả hàng không phải đơn bị hủy; email hoàn tiền: 5.3)', async () => {
      await service.refundReturnedOrder(ADMIN, 'o1');

      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });

    it('COD: chỉ COMPLETED → REFUNDED + chốt Payment COD (hoàn tiền mặt ngoài hệ thống), không có khoản hoàn qua cổng', async () => {
      prisma.order.findUnique.mockResolvedValue(
        orderRow({
          status: 'COMPLETED',
          checkoutGroup: {
            payments: [paymentRow({ method: 'COD', status: 'SUCCESS' })],
          },
        }),
      );
      tx.order.findMany.mockResolvedValue([
        { status: 'REFUNDED', discountAmount: D(0) },
      ]);

      const result = await service.refundReturnedOrder(SELLER, 'o1');

      expect(result.refund).toBeNull();
      expect(tx.paymentRefund.create).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(calls).toEqual(['lockGroup', 'transition']);
      // Chốt Payment COD đọc trạng thái cả nhóm đúng một lần (không xét voucher: trả hàng không trả lượt).
      expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    });

    it('đóng yêu cầu TRẢ HÀNG đang mở (kind RETURN) thành APPROVED', async () => {
      tx.refundRequest.findFirst.mockResolvedValue({
        id: 'req-9',
        status: 'ESCALATED',
      });

      await service.refundReturnedOrder(ADMIN, 'o1', { reason: 'Duyệt' });

      expect(tx.refundRequest.findFirst).toHaveBeenCalledWith({
        where: {
          orderId: 'o1',
          kind: 'RETURN',
          status: { in: ['PENDING_SELLER', 'ESCALATED'] },
        },
        select: { id: true, status: true },
      });
      expect(refundRequestService.transition).toHaveBeenCalledWith(
        tx,
        'req-9',
        'ESCALATED',
        'APPROVED',
        ADMIN,
        'Duyệt',
      );
    });

    it.each([
      'PENDING',
      'CONFIRMED',
      'PACKED',
      'SHIPPING',
      'CANCELLED',
      'REFUNDED',
    ] as const)(
      'đơn %s ⇒ 409 ORDER_INVALID_TRANSITION (chỉ đơn đã COMPLETED mới trả hàng được)',
      async (status) => {
        prisma.order.findUnique.mockResolvedValue(orderRow({ status }));

        await expectAppException(service.refundReturnedOrder(ADMIN, 'o1'), {
          status: 409,
          code: 'ORDER_INVALID_TRANSITION',
        });
      },
    );
  });

  // --- executeRefund ----------------------------------------------------------------------------

  describe('executeRefund', () => {
    it('khoản hoàn không tồn tại ⇒ 404 PAYMENT_REFUND_NOT_FOUND', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(null);

      await expectAppException(service.executeRefund('missing'), {
        status: 404,
        code: 'PAYMENT_REFUND_NOT_FOUND',
      });
    });

    it('khoản hoàn đã chốt (không còn PENDING) ⇒ trả nguyên trạng, KHÔNG gọi cổng lần nữa', async () => {
      refundState.status = 'SUCCEEDED';

      const result = await service.executeRefund('r1');

      expect(result.status).toBe('SUCCEEDED');
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(prisma.paymentRefund.updateMany).not.toHaveBeenCalled();
    });

    it('bị bên khác chốt trước lúc tăng attempts (0 dòng) ⇒ KHÔNG gọi cổng, trả trạng thái hiện tại', async () => {
      prisma.paymentRefund.updateMany.mockResolvedValue({ count: 0 });

      await service.executeRefund('r1');

      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('phương thức không có cổng (MoMo chưa tích hợp) ⇒ FAILED kèm lý do rõ cho Admin, không gọi gì', async () => {
      paymentGateway.get.mockReturnValue(null);

      const result = await service.executeRefund('r1');

      expect(result.status).toBe('FAILED');
      const failed = tx.paymentRefund.updateMany.mock.calls[0] as [
        { data: { failureReason: string } },
      ];
      expect(failed[0].data.failureReason).toContain('No payment gateway');
    });

    it('gọi lại với cùng khoản hoàn dùng CÙNG mã tham chiếu (cổng coi là cùng một yêu cầu)', async () => {
      gatewayResult({ outcome: 'PENDING', gatewayRef: null });

      await service.executeRefund('r1');
      await service.executeRefund('r1');

      const refs = (gateway.refund.mock.calls as [{ refundRef: string }][]).map(
        ([params]) => params.refundRef,
      );
      expect(refs).toEqual(['r1', 'r1']);
    });

    it('id UUID thật ⇒ mã tham chiếu 32 ký tự không gạch ngang', async () => {
      const uuid = '3f2b8c1e-9a4d-4c7e-8b1f-0a2d5e6f7c89';
      prisma.paymentRefund.findUnique.mockResolvedValue({
        id: uuid,
        paymentId: 'p1',
        status: 'PENDING',
        amount: D(410_000),
        gatewayRef: null,
        updatedAt: new Date(),
        payment: {
          method: 'VNPAY',
          txnRef: 'TXN-1',
          transactionId: null,
          amount: D(410_000),
        },
      });

      await service.executeRefund(uuid);

      const params = (
        gateway.refund.mock.calls as [
          { refundRef: string; gatewayTransactionId: string | null },
        ][]
      )[0][0];
      expect(params.refundRef).toBe('3f2b8c1e9a4d4c7e8b1f0a2d5e6f7c89');
      expect(params.gatewayTransactionId).toBeNull();
    });
  });

  // --- finaliseRefund (Tx2) ---------------------------------------------------------------------

  describe('finaliseRefund', () => {
    it('khoản hoàn không tồn tại ⇒ 404', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(null);

      await expectAppException(
        service.finaliseRefund('missing', {
          outcome: 'SUCCESS',
          gatewayRef: 'x',
          failureReason: null,
        }),
        { status: 404, code: 'PAYMENT_REFUND_NOT_FOUND' },
      );
    });

    it('kết quả PENDING ⇒ không mở transaction, không ghi gì', async () => {
      const result = await service.finaliseRefund('r1', {
        outcome: 'PENDING',
        gatewayRef: null,
        failureReason: null,
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('IDEMPOTENT: khoản hoàn đã được chốt bởi bên khác (UPDATE có điều kiện lật 0 dòng) ⇒ KHÔNG cộng tiền lần hai', async () => {
      tx.paymentRefund.updateMany.mockResolvedValue({ count: 0 });

      await service.finaliseRefund('r1', {
        outcome: 'SUCCESS',
        gatewayRef: 'GW-1',
        failureReason: null,
      });

      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('khoá Payment TRƯỚC khi chốt khoản hoàn (cùng thứ tự Payment → … của Tx1)', async () => {
      await service.finaliseRefund('r1', {
        outcome: 'SUCCESS',
        gatewayRef: 'GW-1',
        failureReason: null,
      });

      expect(calls).toEqual(['lockPayment', 'applyToPayment']);
    });

    it('bất biến vỡ (cộng sẽ vượt số đã thu / Payment không còn SUCCESS) ⇒ 409 PAYMENT_NOT_REFUNDABLE để rollback việc chốt', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expectAppException(
        service.finaliseRefund('r1', {
          outcome: 'SUCCESS',
          gatewayRef: 'GW-1',
          failureReason: null,
        }),
        { status: 409, code: 'PAYMENT_NOT_REFUNDABLE' },
      );
    });

    it('FAILED không có lý do ⇒ ghi lý do mặc định cho Admin; chỉ lật từ PENDING', async () => {
      await service.finaliseRefund('r1', {
        outcome: 'FAILED',
        gatewayRef: null,
        failureReason: null,
      });

      expect(tx.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'PENDING' },
        data: {
          status: 'FAILED',
          failureReason: 'Refund was rejected by the payment gateway',
        },
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // --- retryRefund / markRefundCompleted (Admin) ---------------------------------------------------

  describe('retryRefund', () => {
    const stale = () => new Date(Date.now() - REFUND_PENDING_STALE_MS - 1000);

    beforeEach(() => {
      tx.paymentRefund.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve({
          id: 'r1',
          status: refundState.status,
          amount: D(410_000),
          updatedAt: new Date(),
        }),
      );
    });

    it('khoản FAILED ⇒ FAILED → PENDING (xoá lý do lỗi) rồi gọi cổng lại bằng CÙNG dòng và CÙNG mã tham chiếu', async () => {
      refundState.status = 'FAILED';

      const result = await service.retryRefund(ADMIN, 'r1');

      expect(tx.paymentRefund.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'r1', status: 'FAILED' },
        data: { status: 'PENDING', failureReason: null },
      });
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('SUCCEEDED');
    });

    it('thử lại FAILED phải qua kiểm tổng lại: khoản hoàn khác đã vào sau ⇒ 409 PAYMENT_NOT_REFUNDABLE, không gọi cổng (tránh hoàn hai lần)', async () => {
      refundState.status = 'FAILED';
      tx.paymentRefund.aggregate.mockResolvedValue({
        _sum: { amount: D(410_000) },
      });

      await expectAppException(service.retryRefund(ADMIN, 'r1'), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('khoản PENDING bị bỏ dở quá 5 phút ⇒ gọi lại cổng, không đổi trạng thái trước', async () => {
      refundState.status = 'PENDING';
      tx.paymentRefund.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'r1',
        status: 'PENDING',
        amount: D(410_000),
        updatedAt: stale(),
      });

      await service.retryRefund(ADMIN, 'r1');

      expect(gateway.refund).toHaveBeenCalledTimes(1);
    });

    it('khoản PENDING MỚI (dưới 5 phút — lần gọi cổng có thể vẫn đang chạy) ⇒ 409 PAYMENT_REFUND_NOT_RETRYABLE', async () => {
      refundState.status = 'PENDING';

      await expectAppException(service.retryRefund(ADMIN, 'r1'), {
        status: 409,
        code: 'PAYMENT_REFUND_NOT_RETRYABLE',
      });
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('khoản đã SUCCEEDED ⇒ 409 PAYMENT_REFUND_NOT_RETRYABLE, không gọi cổng (retry lần 2 không hoàn thêm)', async () => {
      refundState.status = 'SUCCEEDED';

      await expectAppException(service.retryRefund(ADMIN, 'r1'), {
        status: 409,
        code: 'PAYMENT_REFUND_NOT_RETRYABLE',
      });
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('Payment không còn SUCCESS ⇒ không thử lại khoản FAILED', async () => {
      refundState.status = 'FAILED';
      lockedPayment = { status: 'REFUNDED', amount: '410000.00' };

      await expectAppException(service.retryRefund(ADMIN, 'r1'), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
    });

    it('thua race (khoản FAILED vừa bị bên khác lật) ⇒ 409 NOT_RETRYABLE', async () => {
      refundState.status = 'FAILED';
      tx.paymentRefund.updateMany.mockResolvedValueOnce({ count: 0 });

      await expectAppException(service.retryRefund(ADMIN, 'r1'), {
        status: 409,
        code: 'PAYMENT_REFUND_NOT_RETRYABLE',
      });
    });

    it('khoản hoàn không tồn tại ⇒ 404', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(null);

      await expectAppException(service.retryRefund(ADMIN, 'missing'), {
        status: 404,
        code: 'PAYMENT_REFUND_NOT_FOUND',
      });
    });
  });

  describe('markRefundCompleted', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 'r1',
      paymentId: 'p1',
      status: 'FAILED',
      amount: D(410_000),
      gatewayRef: null,
      updatedAt: new Date(),
      ...overrides,
    });

    it('khoản FAILED ⇒ SUCCEEDED với gatewayRef "MANUAL:<mã>", cộng vào Payment, KHÔNG gọi cổng', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(row());

      await service.markRefundCompleted(ADMIN, 'r1', '  GD-123456  ');

      expect(tx.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'SUCCEEDED',
          gatewayRef: 'MANUAL:GD-123456',
          failureReason: null,
          completedAt: expect.any(Date) as Date,
        },
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('IDEMPOTENT: gọi lại với cùng mã trên khoản đã ghi nhận ⇒ trả nguyên kết quả, KHÔNG cộng tiền lần hai', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(
        row({ status: 'SUCCEEDED', gatewayRef: 'MANUAL:GD-1' }),
      );

      const result = await service.markRefundCompleted(ADMIN, 'r1', 'GD-1');

      expect(result.status).toBe('SUCCEEDED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('đã SUCCEEDED bằng cách khác (cổng hoàn rồi, hoặc mã khác) ⇒ 409 PAYMENT_REFUND_NOT_RETRYABLE', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(
        row({ status: 'SUCCEEDED', gatewayRef: 'GW-REFUND-1' }),
      );
      await expectAppException(
        service.markRefundCompleted(ADMIN, 'r1', 'GD-1'),
        {
          status: 409,
          code: 'PAYMENT_REFUND_NOT_RETRYABLE',
        },
      );

      prisma.paymentRefund.findUnique.mockResolvedValue(
        row({ status: 'SUCCEEDED', gatewayRef: 'MANUAL:GD-1' }),
      );
      await expectAppException(
        service.markRefundCompleted(ADMIN, 'r1', 'GD-2'),
        {
          status: 409,
          code: 'PAYMENT_REFUND_NOT_RETRYABLE',
        },
      );
    });

    it('PENDING còn mới (lần gọi cổng có thể đang chạy — ghi nhận thủ công dễ hoàn hai lần) ⇒ 409', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(
        row({ status: 'PENDING' }),
      );

      await expectAppException(
        service.markRefundCompleted(ADMIN, 'r1', 'GD-1'),
        {
          status: 409,
          code: 'PAYMENT_REFUND_NOT_RETRYABLE',
        },
      );
    });

    it('PENDING bị bỏ dở quá 5 phút ⇒ ghi nhận được', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(
        row({
          status: 'PENDING',
          updatedAt: new Date(Date.now() - REFUND_PENDING_STALE_MS - 1000),
        }),
      );

      await service.markRefundCompleted(ADMIN, 'r1', 'GD-1');

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('mã tham chiếu rỗng là lỗi lập trình của nơi gọi (DTO đã bắt buộc), không ghi gì', async () => {
      await expect(
        service.markRefundCompleted(ADMIN, 'r1', '   '),
      ).rejects.toThrow('A reference is required');
      expect(prisma.paymentRefund.findUnique).not.toHaveBeenCalled();
    });

    it('khoản hoàn không tồn tại ⇒ 404', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(null);

      await expectAppException(service.markRefundCompleted(ADMIN, 'x', 'GD'), {
        status: 404,
        code: 'PAYMENT_REFUND_NOT_FOUND',
      });
    });
  });

  // --- refundPayment (thanh toán bất thường) ---------------------------------------------------

  describe('refundPayment — Admin hoàn thanh toán bất thường, CHỈ chuyển tiền', () => {
    beforeEach(() => {
      groupRows = [{ id: 'o1', status: 'CANCELLED' }];
      tx.payment.findMany.mockResolvedValue([paymentRow()]);
    });

    it('PAID_AFTER_EXPIRY: hoàn TOÀN BỘ amount, khoản hoàn không gắn đơn (orderId null), KHÔNG lật đơn, KHÔNG cộng kho, KHÔNG nhả voucher', async () => {
      const result = await service.refundPayment(
        ADMIN,
        'p1',
        'Thanh toán muộn',
      );

      expect(tx.paymentRefund.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'p1',
          orderId: null,
          refundRequestId: null,
          amount: D(410_000),
          status: 'PENDING',
          reason: 'Thanh toán muộn',
          initiatedByType: 'ADMIN',
          initiatedById: 'admin-1',
        },
        select: { id: true, status: true, amount: true },
      });
      expect(orderStatusService.transition).not.toHaveBeenCalled();
      expect(inventoryService.restock).not.toHaveBeenCalled();
      expect(voucherUsageService.release).not.toHaveBeenCalled();
      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
      expect(result.status).toBe('SUCCEEDED');
    });

    it('khoá Payment rồi đơn cả nhóm (cùng thứ tự các đường hoàn tiền khác)', async () => {
      await service.refundPayment(ADMIN, 'p1');

      expect(calls.slice(0, 3)).toEqual([
        'lockPayment',
        'lockGroup',
        'createRefund',
      ]);
    });

    it('thanh toán TRÙNG (không phải bản SUCCESS sớm nhất) ⇒ hoàn được dù đơn vẫn sống', async () => {
      groupRows = [{ id: 'o1', status: 'PENDING' }];
      tx.payment.findMany.mockResolvedValue([
        paymentRow({ id: 'p0', paidAt: new Date('2026-10-07T08:00:00.000Z') }),
        paymentRow({ id: 'p1', paidAt: new Date('2026-10-07T09:00:00.000Z') }),
      ]);

      await service.refundPayment(ADMIN, 'p1');

      expect(tx.paymentRefund.create).toHaveBeenCalledTimes(1);
    });

    it('khoản thanh toán bình thường (đơn còn sống, là bản duy nhất) ⇒ 409 PAYMENT_NOT_REFUNDABLE — hoàn tiền phải đi qua đơn', async () => {
      groupRows = [{ id: 'o1', status: 'PENDING' }];

      await expectAppException(service.refundPayment(ADMIN, 'p1'), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
      expect(tx.paymentRefund.create).not.toHaveBeenCalled();
    });

    it('Payment đã có BẤT KỲ dòng hoàn nào (kể cả FAILED) ⇒ 409 — dùng retry/ghi nhận thủ công, không tạo dòng thứ hai (tránh hoàn hai lần)', async () => {
      tx.paymentRefund.count.mockResolvedValue(1);

      await expectAppException(service.refundPayment(ADMIN, 'p1'), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
      expect(tx.paymentRefund.create).not.toHaveBeenCalled();
    });

    it('Payment không còn SUCCESS (đã hoàn hết) ⇒ 409', async () => {
      lockedPayment = { status: 'REFUNDED', amount: '410000.00' };

      await expectAppException(service.refundPayment(ADMIN, 'p1'), {
        status: 409,
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
    });

    it('Payment không tồn tại ⇒ 404', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.refundPayment(ADMIN, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cổng lỗi ⇒ khoản hoàn FAILED nhưng request vẫn thành công (Admin thử lại sau)', async () => {
      gatewayResult({ outcome: 'FAILED', failureReason: 'Hết hạn hoàn tiền' });

      const result = await service.refundPayment(ADMIN, 'p1');

      expect(result.status).toBe('FAILED');
    });
  });
});
