import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VerifiedCallback } from '../../shared/payment/payment-gateway.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import type { InventoryService } from '../product/inventory.service';
import type { VoucherUsageService } from '../voucher/voucher-usage.service';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService } from './order-status.service';
import { PaymentService } from './payment.service';

const SUCCESS_CALLBACK: VerifiedCallback = {
  isSignatureValid: true,
  txnRef: 'TXN1',
  amountVnd: 100_000,
  gatewayTransactionId: 'GW1',
  outcome: 'SUCCESS',
};

const FAILED_CALLBACK: VerifiedCallback = {
  ...SUCCESS_CALLBACK,
  outcome: 'FAILED',
};

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: {
    payment: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    checkoutGroup: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    $queryRaw: jest.Mock;
    payment: { update: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
    orderItem: { findMany: jest.Mock };
  };
  let inventoryService: { commit: jest.Mock; release: jest.Mock };
  let orderStatusService: { transition: jest.Mock };
  let orderEmailService: {
    notifyPlaced: jest.Mock;
    notifyCancelled: jest.Mock;
  };
  let voucherUsageService: { release: jest.Mock };
  let paymentGateway: { availabilityOf: jest.Mock; getConfigured: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      payment: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = {
      payment: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      checkoutGroup: { findFirst: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    };
    inventoryService = {
      commit: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    voucherUsageService = { release: jest.fn().mockResolvedValue(0) };
    orderStatusService = { transition: jest.fn().mockResolvedValue([]) };
    orderEmailService = {
      notifyPlaced: jest.fn().mockResolvedValue(undefined),
      notifyCancelled: jest.fn().mockResolvedValue(undefined),
    };
    paymentGateway = {
      availabilityOf: jest.fn().mockReturnValue({ available: true }),
      getConfigured: jest.fn().mockReturnValue({
        createPayment: jest
          .fn()
          .mockResolvedValue({ payUrl: 'https://pay.example/new' }),
      }),
    };

    service = new PaymentService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
      voucherUsageService as unknown as VoucherUsageService,
      paymentGateway as unknown as PaymentGatewayService,
      orderStatusService as unknown as OrderStatusService,
      orderEmailService as unknown as OrderEmailService,
    );
  });

  describe('confirmPayment — fail-fast trước khi chạm nhánh SUCCESS/FAILED', () => {
    it('chữ ký sai — INVALID_SIGNATURE, không đọc DB', async () => {
      const result = await service.confirmPayment(
        { ...SUCCESS_CALLBACK, isSignatureValid: false },
        'IPN',
      );
      expect(result).toEqual({
        outcome: 'INVALID_SIGNATURE',
        checkoutGroupId: null,
      });
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('không có txnRef dù chữ ký hợp lệ — INVALID_SIGNATURE', async () => {
      const result = await service.confirmPayment(
        { ...SUCCESS_CALLBACK, txnRef: null },
        'IPN',
      );
      expect(result.outcome).toBe('INVALID_SIGNATURE');
    });

    it('txnRef không tồn tại — NOT_FOUND', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({ outcome: 'NOT_FOUND', checkoutGroupId: null });
    });

    it('số tiền lệch — AMOUNT_MISMATCH, kèm checkoutGroupId để redirect', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        amount: new Prisma.Decimal(999_999),
        checkoutGroupId: 'g1',
      });

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({
        outcome: 'AMOUNT_MISMATCH',
        checkoutGroupId: 'g1',
      });
    });

    it('amountVnd null (callback không hợp lệ dù chữ ký đúng) — AMOUNT_MISMATCH', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });

      const result = await service.confirmPayment(
        { ...SUCCESS_CALLBACK, amountVnd: null },
        'IPN',
      );

      expect(result.outcome).toBe('AMOUNT_MISMATCH');
    });

    it('outcome PENDING/không xác định — UNRECOGNIZED, không ghi DB', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });

      const result = await service.confirmPayment(
        { ...SUCCESS_CALLBACK, outcome: 'PENDING' },
        'IPN',
      );

      expect(result).toEqual({
        outcome: 'UNRECOGNIZED',
        checkoutGroupId: 'g1',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('confirmPayment — outcome SUCCESS', () => {
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });
    });

    it('bình thường: PENDING → SUCCESS, đơn AWAITING_PAYMENT → PENDING, chốt kho', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ status: 'PENDING' }]) // khoá payment
        .mockResolvedValueOnce([
          { id: 'o1', status: 'AWAITING_PAYMENT' },
          { id: 'o2', status: 'AWAITING_PAYMENT' },
        ]); // khoá đơn
      orderStatusService.transition.mockResolvedValue(['o1', 'o2']);
      tx.orderItem.findMany.mockResolvedValue([
        { productVariantId: 'v1', quantity: 2 },
        { productVariantId: 'v2', quantity: 1 },
      ]);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({ outcome: 'CONFIRMED', checkoutGroupId: 'g1' });
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1', 'o2'],
        'AWAITING_PAYMENT',
        'PENDING',
        { type: 'SYSTEM' },
        expect.any(String) as string,
      );
      // Chỉ chốt kho cho ĐÚNG các đơn thật sự lật được.
      expect(tx.orderItem.findMany).toHaveBeenCalledWith({
        where: { orderId: { in: ['o1', 'o2'] } },
        select: { productVariantId: true, quantity: true },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          status: 'SUCCESS',
          transactionId: 'GW1',
          paidAt: expect.any(Date) as Date,
        },
      });
      expect(inventoryService.commit).toHaveBeenCalledWith(tx, [
        { productVariantId: 'v1', quantity: 2 },
        { productVariantId: 'v2', quantity: 1 },
      ]);
    });

    describe('email "thanh toán thành công" (Week8.md 2.8)', () => {
      it('lần xác nhận thật sự đầu tiên (CONFIRMED) — gửi ĐÚNG 1 email cho nhóm, SAU transaction', async () => {
        tx.$queryRaw
          .mockResolvedValueOnce([{ status: 'PENDING' }])
          .mockResolvedValueOnce([{ id: 'o1', status: 'AWAITING_PAYMENT' }]);
        orderStatusService.transition.mockResolvedValue(['o1']);
        tx.orderItem.findMany.mockResolvedValue([
          { productVariantId: 'v1', quantity: 1 },
        ]);
        const order: string[] = [];
        prisma.$transaction.mockImplementation(
          async (fn: (t: unknown) => unknown) => {
            const result = await fn(tx);
            order.push('commit');
            return result;
          },
        );
        orderEmailService.notifyPlaced.mockImplementation(() => {
          order.push('email');
          return Promise.resolve();
        });

        await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

        expect(orderEmailService.notifyPlaced).toHaveBeenCalledTimes(1);
        expect(orderEmailService.notifyPlaced).toHaveBeenCalledWith('g1');
        expect(order).toEqual(['commit', 'email']); // email SAU commit, không nằm trong transaction
      });

      it.each([
        ['đã SUCCESS từ trước (IPN + return gọi lặp)', 'ALREADY_CONFIRMED'],
      ])('%s — KHÔNG gửi lại', async () => {
        tx.$queryRaw.mockResolvedValueOnce([{ status: 'SUCCESS' }]);

        const result = await service.confirmPayment(SUCCESS_CALLBACK, 'RETURN');

        expect(result.outcome).toBe('ALREADY_CONFIRMED');
        expect(orderEmailService.notifyPlaced).not.toHaveBeenCalled();
      });

      it('thanh toán trùng / đến muộn sau khi nhóm đã hủy — KHÔNG gửi email "thành công"', async () => {
        for (const orderStatus of ['PENDING', 'CANCELLED']) {
          tx.$queryRaw
            .mockResolvedValueOnce([{ status: 'PENDING' }])
            .mockResolvedValueOnce([{ id: 'o1', status: orderStatus }]);
          orderStatusService.transition.mockResolvedValue([]);

          await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');
        }

        expect(orderEmailService.notifyPlaced).not.toHaveBeenCalled();
      });

      it('thanh toán thất bại — không gửi email', async () => {
        await service.confirmPayment(FAILED_CALLBACK, 'IPN');

        expect(orderEmailService.notifyPlaced).not.toHaveBeenCalled();
      });
    });

    it('đã SUCCESS từ trước (dưới khoá) — ALREADY_CONFIRMED, không ghi lại/không chốt kho', async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ status: 'SUCCESS' }]);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({
        outcome: 'ALREADY_CONFIRMED',
        checkoutGroupId: 'g1',
      });
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(inventoryService.commit).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // không đi tiếp tới khoá đơn
    });

    it('FAILED nhưng đơn vẫn AWAITING_PAYMENT (mâu thuẫn) — vẫn CONFIRMED + chốt kho', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ status: 'FAILED' }])
        .mockResolvedValueOnce([{ id: 'o1', status: 'AWAITING_PAYMENT' }]);
      orderStatusService.transition.mockResolvedValue(['o1']);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result.outcome).toBe('CONFIRMED');
      expect(inventoryService.commit).toHaveBeenCalled();
    });

    it('0 đơn lật được, đơn đang PENDING (đã có lần thử khác thành công) — DUPLICATE_SUCCESS_RECORDED', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ status: 'PENDING' }])
        .mockResolvedValueOnce([{ id: 'o1', status: 'PENDING' }]);
      orderStatusService.transition.mockResolvedValue([]);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({
        outcome: 'DUPLICATE_SUCCESS_RECORDED',
        checkoutGroupId: 'g1',
      });
      expect(inventoryService.commit).not.toHaveBeenCalled();
      // Vẫn ghi nhận SUCCESS cho ĐÚNG lần thử này (tiền thật đã vào).
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'SUCCESS' }) as unknown,
      });
    });

    it('0 đơn lật được, đơn đã CANCELLED (nhóm đã bị thu hồi) — LATE_SUCCESS_RECORDED', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ status: 'FAILED' }])
        .mockResolvedValueOnce([{ id: 'o1', status: 'CANCELLED' }]);
      orderStatusService.transition.mockResolvedValue([]);

      const result = await service.confirmPayment(SUCCESS_CALLBACK, 'IPN');

      expect(result).toEqual({
        outcome: 'LATE_SUCCESS_RECORDED',
        checkoutGroupId: 'g1',
      });
      expect(inventoryService.commit).not.toHaveBeenCalled();
      expect(tx.payment.update).toHaveBeenCalled(); // vẫn ghi SUCCESS, không hồi sinh đơn
    });
  });

  describe('confirmPayment — outcome FAILED', () => {
    it('lần thử đang PENDING — FAILED_RECORDED, KHÔNG đụng đơn/kho/voucher', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.confirmPayment(FAILED_CALLBACK, 'IPN');

      expect(result).toEqual({
        outcome: 'FAILED_RECORDED',
        checkoutGroupId: 'g1',
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(inventoryService.release).not.toHaveBeenCalled();
    });

    it('đã FAILED từ trước — ALREADY_CONFIRMED, updateMany khớp 0 dòng', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'FAILED',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.confirmPayment(FAILED_CALLBACK, 'IPN');

      expect(result.outcome).toBe('ALREADY_CONFIRMED');
    });

    it('đã SUCCESS — KHÔNG BAO GIỜ hạ xuống FAILED, ALREADY_CONFIRMED, không gọi updateMany', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'SUCCESS',
        amount: new Prisma.Decimal(100_000),
        checkoutGroupId: 'g1',
      });

      const result = await service.confirmPayment(FAILED_CALLBACK, 'IPN');

      expect(result.outcome).toBe('ALREADY_CONFIRMED');
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reclaimCheckoutGroup', () => {
    it('nhóm đã có Payment SUCCESS — không đụng gì, reclaimed=false', async () => {
      tx.payment.count.mockResolvedValue(1);

      const result = await service.reclaimCheckoutGroup('g1');

      expect(result).toEqual({ reclaimed: false });
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('bình thường: lật Payment PENDING→FAILED, đơn AWAITING_PAYMENT→CANCELLED, nhả kho + voucher', async () => {
      tx.payment.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([
        { id: 'o1', status: 'AWAITING_PAYMENT' },
        { id: 'o2', status: 'CANCELLED' }, // đơn khác của nhóm đã huỷ trước đó (không liên quan)
      ]);
      orderStatusService.transition.mockResolvedValue(['o1']);
      tx.orderItem.findMany.mockResolvedValue([
        { productVariantId: 'v1', quantity: 3 },
      ]);

      const result = await service.reclaimCheckoutGroup('g1');

      expect(result).toEqual({ reclaimed: true });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        // KHÔNG đụng Payment COD (Week8.md 2.7).
        where: {
          checkoutGroupId: 'g1',
          status: 'PENDING',
          method: { not: 'COD' },
        },
        data: { status: 'FAILED' },
      });
      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'AWAITING_PAYMENT',
        'CANCELLED',
        { type: 'SYSTEM' },
        expect.any(String) as string,
      );
      expect(inventoryService.release).toHaveBeenCalledWith(tx, [
        { productVariantId: 'v1', quantity: 3 },
      ]);
      expect(voucherUsageService.release).toHaveBeenCalledWith(tx, 'g1');
    });

    it('không còn đơn AWAITING_PAYMENT nào (đã reclaim trước đó) — idempotent, không nhả gì thêm', async () => {
      tx.payment.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([{ id: 'o1', status: 'CANCELLED' }]);

      const result = await service.reclaimCheckoutGroup('g1');

      expect(result).toEqual({ reclaimed: false });
      expect(orderStatusService.transition).not.toHaveBeenCalled();
      expect(inventoryService.release).not.toHaveBeenCalled();
      expect(voucherUsageService.release).not.toHaveBeenCalled();
    });

    it('race: khoá được đơn nhưng chuyển trạng thái lật 0 đơn — không nhả (lưới an toàn)', async () => {
      tx.payment.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([
        { id: 'o1', status: 'AWAITING_PAYMENT' },
      ]);
      orderStatusService.transition.mockResolvedValue([]);

      const result = await service.reclaimCheckoutGroup('g1');

      expect(result).toEqual({ reclaimed: false });
      expect(inventoryService.release).not.toHaveBeenCalled();
    });
  });

  describe('reclaimCheckoutGroup — email báo hủy (Week8.md 2.8)', () => {
    beforeEach(() => {
      tx.payment.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([
        { id: 'o1', status: 'AWAITING_PAYMENT' },
      ]);
    });

    it('hết hạn thanh toán (actor mặc định SYSTEM) — báo "hết hạn", không có lý do', async () => {
      orderStatusService.transition.mockResolvedValue(['o1']);

      await service.reclaimCheckoutGroup('g1');

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { checkoutGroupId: 'g1' },
        'SYSTEM',
        null,
      );
    });

    it('buyer chủ động hủy — báo "bạn đã hủy" kèm lý do buyer nhập', async () => {
      orderStatusService.transition.mockResolvedValue(['o1']);

      await service.reclaimCheckoutGroup('g1', {
        actor: { type: 'BUYER', id: 'user-1' },
        note: 'Đổi ý',
      });

      expect(orderEmailService.notifyCancelled).toHaveBeenCalledWith(
        { checkoutGroupId: 'g1' },
        'BUYER',
        'Đổi ý',
      );
    });

    it('không thu hồi được gì (nhóm đã có SUCCESS / đã hủy từ trước) — KHÔNG gửi lại (idempotent)', async () => {
      tx.payment.count.mockResolvedValue(1);
      await service.reclaimCheckoutGroup('g1');

      tx.payment.count.mockResolvedValue(0);
      orderStatusService.transition.mockResolvedValue([]);
      await service.reclaimCheckoutGroup('g1');

      expect(orderEmailService.notifyCancelled).not.toHaveBeenCalled();
    });
  });

  describe('reclaimCheckoutGroup — actor tuỳ chọn (buyer chủ động hủy)', () => {
    it('truyền actor BUYER + note — ghi đúng người thực hiện thay vì SYSTEM mặc định', async () => {
      tx.payment.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([
        { id: 'o1', status: 'AWAITING_PAYMENT' },
      ]);
      orderStatusService.transition.mockResolvedValue(['o1']);

      await service.reclaimCheckoutGroup('g1', {
        actor: { type: 'BUYER', id: 'user-1' },
        note: 'Đổi ý',
      });

      expect(orderStatusService.transition).toHaveBeenCalledWith(
        tx,
        ['o1'],
        'AWAITING_PAYMENT',
        'CANCELLED',
        { type: 'BUYER', id: 'user-1' },
        'Đổi ý',
      );
    });
  });

  describe('cancelCheckoutGroup (buyer hủy cả nhóm chưa thanh toán)', () => {
    const view = (status: string) =>
      ({ id: 'g1', status }) as unknown as Awaited<
        ReturnType<PaymentService['getCheckoutGroup']>
      >;
    let reclaim: jest.SpyInstance;
    let getGroup: jest.SpyInstance;

    beforeEach(() => {
      prisma.checkoutGroup.findFirst.mockResolvedValue({
        id: 'g1',
        userId: 'user-1',
      });
      reclaim = jest.spyOn(service, 'reclaimCheckoutGroup');
      getGroup = jest.spyOn(service, 'getCheckoutGroup');
    });

    it('nhóm của người khác / không tồn tại — 404, không thu hồi gì', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelCheckoutGroup('user-1', 'g-khac'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reclaim).not.toHaveBeenCalled();
    });

    it('thu hồi thành công — gọi reclaim với actor BUYER, trả trạng thái mới', async () => {
      reclaim.mockResolvedValue({ reclaimed: true });
      getGroup.mockResolvedValue(view('CANCELLED'));

      const result = await service.cancelCheckoutGroup('user-1', 'g1', 'Đổi ý');

      expect(reclaim).toHaveBeenCalledWith('g1', {
        actor: { type: 'BUYER', id: 'user-1' },
        note: 'Đổi ý',
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('không có lý do — note mặc định', async () => {
      reclaim.mockResolvedValue({ reclaimed: true });
      getGroup.mockResolvedValue(view('CANCELLED'));

      await service.cancelCheckoutGroup('user-1', 'g1');

      expect(reclaim).toHaveBeenCalledWith('g1', {
        actor: { type: 'BUYER', id: 'user-1' },
        note: 'Cancelled by buyer',
      });
    });

    it('idempotent: nhóm đã hủy từ trước (reclaim 0 đơn) — trả trạng thái hiện tại, không lỗi', async () => {
      reclaim.mockResolvedValue({ reclaimed: false });
      getGroup.mockResolvedValue(view('CANCELLED'));

      await expect(
        service.cancelCheckoutGroup('user-1', 'g1'),
      ).resolves.toMatchObject({ status: 'CANCELLED' });
    });

    it.each(['PAID', 'PAID_AFTER_EXPIRY'])(
      'nhóm đã thanh toán (%s) — 409 ORDER_CANCEL_NOT_ALLOWED / PAID_ONLINE',
      async (status) => {
        reclaim.mockResolvedValue({ reclaimed: false });
        getGroup.mockResolvedValue(view(status));

        await expectAppException(service.cancelCheckoutGroup('user-1', 'g1'), {
          status: 409,
          code: 'ORDER_CANCEL_NOT_ALLOWED',
          details: { reason: 'PAID_ONLINE' },
        });
      },
    );

    it('nhóm không còn đơn chờ thanh toán (vd COD đã đặt) — 409 ORDER_INVALID_TRANSITION', async () => {
      reclaim.mockResolvedValue({ reclaimed: false });
      getGroup.mockResolvedValue(view('COD_PLACED'));

      await expectAppException(service.cancelCheckoutGroup('user-1', 'g1'), {
        status: 409,
        code: 'ORDER_INVALID_TRANSITION',
      });
    });
  });

  describe('getCheckoutGroup', () => {
    const baseGroup = (overrides: Record<string, unknown> = {}) => ({
      id: 'g1',
      userId: 'user-1',
      createdAt: new Date('2026-09-27T00:00:00.000Z'),
      orders: [
        {
          id: 'o1',
          shopId: 'shop-1',
          status: 'PENDING',
          totalAmount: new Prisma.Decimal(120_000),
          discountAmount: new Prisma.Decimal(0),
          shippingFee: new Prisma.Decimal(20_000),
          shop: { name: 'Shop A' },
          items: [
            {
              productVariantId: 'v1',
              productName: 'Áo thun',
              variantLabel: 'Đỏ / M',
              sku: 'SKU1',
              imageUrl: null,
              quantity: 1,
              priceAtPurchase: new Prisma.Decimal(100_000),
            },
          ],
        },
      ],
      payments: [
        {
          id: 'p1',
          status: 'SUCCESS',
          method: 'VNPAY',
          amount: new Prisma.Decimal(120_000),
          txnRef: 'TXN1',
          payUrl: 'https://pay.example/1',
          expiresAt: new Date('2026-09-27T00:15:00.000Z'),
          createdAt: new Date('2026-09-27T00:00:00.000Z'),
        },
      ],
      ...overrides,
    });

    it('nhóm của người khác — 404, không lộ dữ liệu', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.getCheckoutGroup('user-1', 'g-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('trả đúng shape — status/canRetry/subtotal suy từ Order, không lazy-reclaim khi đã PAID', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(baseGroup());
      const reclaimSpy = jest
        .spyOn(service, 'reclaimCheckoutGroup')
        .mockResolvedValue({ reclaimed: true });

      const result = await service.getCheckoutGroup('user-1', 'g1');

      expect(reclaimSpy).not.toHaveBeenCalled();
      expect(result.status).toBe('PAID');
      expect(result.canRetry).toBe(false);
      expect(result.paymentMethod).toBe('VNPAY');
      expect(result.orders[0]).toMatchObject({
        shopName: 'Shop A',
        subtotal: '100000', // 120000 (total) + 0 (discount) - 20000 (ship)
        shippingFee: '20000',
        totalAmount: '120000',
      });
    });

    it('lần thử mới nhất quá expiresAt + ân hạn, chưa có Payment SUCCESS — tự reclaim rồi đọc lại', async () => {
      const lapsedGroup = baseGroup({
        payments: [
          {
            id: 'p1',
            status: 'PENDING',
            method: 'VNPAY',
            amount: new Prisma.Decimal(120_000),
            txnRef: 'TXN1',
            payUrl: null,
            // Quá xa trong quá khứ để chắc chắn vượt ân hạn mặc định (5 phút).
            expiresAt: new Date(Date.now() - 60 * 60_000),
            createdAt: new Date(Date.now() - 90 * 60_000),
          },
        ],
      });
      prisma.checkoutGroup.findFirst
        .mockResolvedValueOnce(lapsedGroup)
        .mockResolvedValueOnce(
          baseGroup({
            orders: [{ ...baseGroup().orders[0], status: 'CANCELLED' }],
            payments: [{ ...lapsedGroup.payments[0], status: 'FAILED' }],
          }),
        );
      const reclaimSpy = jest
        .spyOn(service, 'reclaimCheckoutGroup')
        .mockResolvedValue({ reclaimed: true });

      const result = await service.getCheckoutGroup('user-1', 'g1');

      expect(reclaimSpy).toHaveBeenCalledWith('g1');
      expect(prisma.checkoutGroup.findFirst).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('retryPayment', () => {
    function pendingGroup(overrides: Record<string, unknown> = {}) {
      return {
        id: 'g1',
        userId: 'user-1',
        createdAt: new Date(),
        orders: [{ id: 'o1', status: 'AWAITING_PAYMENT' }],
        payments: [
          {
            id: 'p1',
            status: 'PENDING',
            method: 'VNPAY',
            amount: new Prisma.Decimal(120_000),
            txnRef: 'TXN1',
            payUrl: 'https://pay.example/old',
            expiresAt: new Date(Date.now() + 10 * 60_000),
            createdAt: new Date(),
          },
        ],
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.spyOn(service, 'reclaimCheckoutGroup').mockResolvedValue({
        reclaimed: false,
      });
    });

    it('nhóm của người khác — 404', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.retryPayment('user-1', 'g-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('đã PAID — 409 PAYMENT_RETRY_NOT_ALLOWED reason ALREADY_PAID', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          orders: [{ id: 'o1', status: 'PENDING' }],
          payments: [
            {
              ...pendingGroup().payments[0],
              status: 'SUCCESS',
            },
          ],
        }),
      );

      await expectAppException(service.retryPayment('user-1', 'g1'), {
        status: 409,
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'ALREADY_PAID' },
      });
    });

    it('nhóm COD (COD_PLACED) — 409 reason NOT_ONLINE_PAYMENT, không gọi cổng', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          orders: [{ id: 'o1', status: 'PENDING' }],
          payments: [
            {
              ...pendingGroup().payments[0],
              method: 'COD',
              payUrl: null,
              expiresAt: null,
            },
          ],
        }),
      );

      await expectAppException(service.retryPayment('user-1', 'g1'), {
        status: 409,
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'NOT_ONLINE_PAYMENT' },
      });
      expect(paymentGateway.getConfigured).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('đã hết hạn giữ (PAYMENT_EXPIRED) — 409 reason HOLD_EXPIRED', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          payments: [
            {
              ...pendingGroup().payments[0],
              expiresAt: new Date(Date.now() - 60_000),
            },
          ],
        }),
      );

      await expectAppException(service.retryPayment('user-1', 'g1'), {
        status: 409,
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'HOLD_EXPIRED' },
      });
    });

    it('còn PENDING/chưa hết hạn nhưng đã chạm MAX_HOLD — 409 reason HOLD_EXPIRED', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({ createdAt: new Date(Date.now() - 40 * 60_000) }), // > MAX_HOLD mặc định 30 phút
      );

      await expectAppException(service.retryPayment('user-1', 'g1'), {
        status: 409,
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'HOLD_EXPIRED' },
      });
    });

    it('PENDING chưa hết hạn, CÓ payUrl — trả lại URL đã lưu, không tạo lần thử mới', async () => {
      const group = pendingGroup();
      prisma.checkoutGroup.findFirst.mockResolvedValue(group);

      const result = await service.retryPayment('user-1', 'g1');

      expect(result).toEqual({
        paymentUrl: 'https://pay.example/old',
        expiresAt: group.payments[0].expiresAt.toISOString(),
        created: false,
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('PENDING chưa hết hạn nhưng KHÔNG có payUrl — đánh dấu FAILED rồi tạo lần thử mới', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          payments: [{ ...pendingGroup().payments[0], payUrl: null }],
        }),
      );

      const result = await service.retryPayment('user-1', 'g1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(result.paymentUrl).toBe('https://pay.example/new');
    });

    it('lần thử mới nhất đã FAILED, còn trong hạn giữ — tạo lần thử mới ngay (không cần đánh dấu lại)', async () => {
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          payments: [{ ...pendingGroup().payments[0], status: 'FAILED' }],
        }),
      );

      const result = await service.retryPayment('user-1', 'g1');

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(result.paymentUrl).toBe('https://pay.example/new');
    });

    it('phương thức không khả dụng (vượt trần/sàn) — 409 PAYMENT_METHOD_UNAVAILABLE, không tạo lần thử', async () => {
      paymentGateway.availabilityOf.mockReturnValue({
        available: false,
        reason: 'AMOUNT_TOO_LARGE',
      });
      prisma.checkoutGroup.findFirst.mockResolvedValue(
        pendingGroup({
          payments: [{ ...pendingGroup().payments[0], payUrl: null }],
        }),
      );

      await expectAppException(service.retryPayment('user-1', 'g1'), {
        status: 409,
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        details: { method: 'VNPAY', reason: 'AMOUNT_TOO_LARGE' },
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
