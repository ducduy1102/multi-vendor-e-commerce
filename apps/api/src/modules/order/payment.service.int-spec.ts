import { PrismaClient } from '@prisma/client';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import type { VerifiedCallback } from '../../shared/payment/payment-gateway.interface';
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService } from './order-status.service';
import { PaymentService } from './payment.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh confirmPayment/
// reclaimCheckoutGroup (Week7.md 2.9) đúng ở mức mà unit test với mock không chứng minh được — khoá
// hàng thật của Postgres thật sự tuần tự hoá 2 giao dịch đồng thời, không deadlock, và chỉ 1 bên
// chốt/nhả kho. Chạy: `pnpm test:int`.
//
// Dựng thẳng CheckoutGroup/Order/OrderItem/Payment bằng Prisma (KHÔNG qua CheckoutService.placeOrder)
// vì module `order` không được import `checkout` (Week7.md 1.14) — mô phỏng đúng trạng thái mà
// placeOrder để lại: đơn AWAITING_PAYMENT, variant đã reservedStock đúng số lượng.
const TAG = 'it-payment-';

describe('PaymentService (DB thật)', () => {
  const prisma = new PrismaClient();
  const inventoryService = new InventoryService();
  const voucherUsageService = new VoucherUsageService();
  const paymentGateway = new PaymentGatewayService(
    new VnpayProvider(),
    new MockPaymentProvider(),
  );
  const service = new PaymentService(
    prisma as unknown as PrismaService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
    new OrderStatusService(),
    new OrderEmailService(
      prisma as unknown as PrismaService,
      createFakeMail().mailService,
    ),
  );

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  async function setupGroup(
    lines: Array<{ stock: number; price: number; quantity: number }>,
  ) {
    const user = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    const orders: { id: string; variantId: string }[] = [];
    let totalAmount = 0;

    for (const line of lines) {
      const base = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, base, {
        stock: line.stock,
        reservedStock: line.quantity,
        price: line.price,
      });
      const amount = line.price * line.quantity;
      totalAmount += amount;
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status: 'AWAITING_PAYMENT',
          totalAmount: amount,
          recipientName: 'Nguyễn Văn A',
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          shippingProvince: 'Hồ Chí Minh',
          items: {
            create: [
              {
                productVariantId: variant.id,
                quantity: line.quantity,
                priceAtPurchase: line.price,
                productName: `${TAG}product`,
                sku: `SKU-${variant.id}`,
                variantLabel: null,
                imageUrl: null,
              },
            ],
          },
        },
        select: { id: true },
      });
      orders.push({ id: order.id, variantId: variant.id });
    }

    const txnRef = `${TAG.toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: 'VNPAY',
        amount: totalAmount,
        txnRef,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });

    return { groupId: group.id, orders, txnRef, amount: totalAmount };
  }

  const successCallback = (
    txnRef: string,
    amount: number,
  ): VerifiedCallback => ({
    isSignatureValid: true,
    txnRef,
    amountVnd: amount,
    gatewayTransactionId: 'GW-TEST',
    outcome: 'SUCCESS',
  });

  const stockOf = (id: string) =>
    prisma.productVariant.findUniqueOrThrow({
      where: { id },
      select: { stock: true, reservedStock: true },
    });
  const orderStatusOf = async (id: string) =>
    (
      await prisma.order.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;

  describe('confirmPayment', () => {
    it('CONFIRMED: chốt kho thật, lật đơn AWAITING_PAYMENT → PENDING, ghi Payment SUCCESS', async () => {
      const { groupId, orders, txnRef, amount } = await setupGroup([
        { stock: 10, price: 100_000, quantity: 3 },
      ]);

      const result = await service.confirmPayment(
        successCallback(txnRef, amount),
        'IPN',
      );

      expect(result).toEqual({
        outcome: 'CONFIRMED',
        checkoutGroupId: groupId,
      });
      expect(await orderStatusOf(orders[0].id)).toBe('PENDING');
      expect(await stockOf(orders[0].variantId)).toEqual({
        stock: 7,
        reservedStock: 0,
      });
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { txnRef },
      });
      expect(payment.status).toBe('SUCCESS');
      expect(payment.transactionId).toBe('GW-TEST');
    });

    it('2 lệnh xác nhận ĐỒNG THỜI cùng txnRef (IPN + return) — chỉ chốt kho ĐÚNG 1 lần', async () => {
      const { orders, txnRef, amount } = await setupGroup([
        { stock: 10, price: 50_000, quantity: 2 },
      ]);

      const [a, b] = await Promise.all([
        service.confirmPayment(successCallback(txnRef, amount), 'IPN'),
        service.confirmPayment(successCallback(txnRef, amount), 'RETURN'),
      ]);

      expect([a.outcome, b.outcome].sort()).toEqual([
        'ALREADY_CONFIRMED',
        'CONFIRMED',
      ]);
      expect(await stockOf(orders[0].variantId)).toEqual({
        stock: 8,
        reservedStock: 0,
      });
    });

    it('gọi lặp lại 3 lần (giống VNPay thử lại IPN) — vẫn chỉ chốt kho 1 lần', async () => {
      const { orders, txnRef, amount } = await setupGroup([
        { stock: 5, price: 20_000, quantity: 1 },
      ]);

      const r1 = await service.confirmPayment(
        successCallback(txnRef, amount),
        'IPN',
      );
      const r2 = await service.confirmPayment(
        successCallback(txnRef, amount),
        'IPN',
      );
      const r3 = await service.confirmPayment(
        successCallback(txnRef, amount),
        'RETURN',
      );

      expect(r1.outcome).toBe('CONFIRMED');
      expect(r2.outcome).toBe('ALREADY_CONFIRMED');
      expect(r3.outcome).toBe('ALREADY_CONFIRMED');
      expect(await stockOf(orders[0].variantId)).toEqual({
        stock: 4,
        reservedStock: 0,
      });
    });
  });

  describe('nhóm COD (Week8.md 2.7) — không bao giờ bị thu hồi', () => {
    // Nhóm COD đúng như placeOrder để lại: đơn PENDING, kho đã chốt, Payment COD PENDING không hạn.
    async function setupCodGroup() {
      const user = await createUser(prisma, TAG);
      const group = await createCheckoutGroup(prisma, user.id);
      const base = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, base, { stock: 8 });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status: 'PENDING',
          totalAmount: 100_000,
          recipientName: 'A',
          recipientPhone: '0900000000',
          shippingAddressLine: 'x',
          shippingWard: 'x',
          shippingProvince: 'Hồ Chí Minh',
          items: {
            create: [
              {
                productVariantId: variant.id,
                quantity: 2,
                priceAtPurchase: 50_000,
                productName: `${TAG}product`,
                sku: `SKU-${variant.id}`,
                variantLabel: null,
                imageUrl: null,
              },
            ],
          },
        },
        select: { id: true },
      });
      const payment = await prisma.payment.create({
        data: {
          checkoutGroupId: group.id,
          method: 'COD',
          status: 'PENDING',
          amount: 100_000,
          txnRef: `${TAG.toUpperCase()}COD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          expiresAt: null,
        },
      });
      return {
        userId: user.id,
        groupId: group.id,
        orderId: order.id,
        paymentId: payment.id,
        variantId: variant.id,
      };
    }

    const paymentStatusOf = async (id: string) =>
      (await prisma.payment.findUniqueOrThrow({ where: { id } })).status;

    it('reclaimCheckoutGroup gọi thẳng: không đổi gì — Payment COD vẫn PENDING (không bị đánh FAILED), đơn/kho nguyên vẹn', async () => {
      const { groupId, orderId, paymentId, variantId } = await setupCodGroup();

      const result = await service.reclaimCheckoutGroup(groupId);

      expect(result).toEqual({ reclaimed: false });
      expect(await paymentStatusOf(paymentId)).toBe('PENDING');
      expect(await orderStatusOf(orderId)).toBe('PENDING');
      expect(await stockOf(variantId)).toEqual({ stock: 8, reservedStock: 0 });
    });

    it('buyer "hủy nhóm" với nhóm COD — 409 ORDER_INVALID_TRANSITION, Payment COD KHÔNG bị hỏng', async () => {
      const { userId, groupId, orderId, paymentId } = await setupCodGroup();

      await expectAppException(service.cancelCheckoutGroup(userId, groupId), {
        status: 409,
        code: 'ORDER_INVALID_TRANSITION',
      });

      expect(await paymentStatusOf(paymentId)).toBe('PENDING');
      expect(await orderStatusOf(orderId)).toBe('PENDING');
    });

    it('"thanh toán lại" với nhóm COD — 409 PAYMENT_RETRY_NOT_ALLOWED / NOT_ONLINE_PAYMENT', async () => {
      const { userId, groupId } = await setupCodGroup();

      await expectAppException(service.retryPayment(userId, groupId), {
        status: 409,
        code: 'PAYMENT_RETRY_NOT_ALLOWED',
        details: { reason: 'NOT_ONLINE_PAYMENT' },
      });
    });

    it('GET nhóm COD: status COD_PLACED, không hạn, không cho thử lại', async () => {
      const { userId, groupId } = await setupCodGroup();

      const view = await service.getCheckoutGroup(userId, groupId);

      expect(view).toMatchObject({
        status: 'COD_PLACED',
        canRetry: false,
        expiresAt: null,
        paymentMethod: 'COD',
      });
    });
  });

  describe('reclaimCheckoutGroup', () => {
    it('nhả đúng reservedStock, huỷ đơn — gọi lặp lại thì idempotent (không nhả 2 lần)', async () => {
      const { groupId, orders } = await setupGroup([
        { stock: 10, price: 30_000, quantity: 4 },
      ]);

      const first = await service.reclaimCheckoutGroup(groupId);
      const second = await service.reclaimCheckoutGroup(groupId);

      expect(first).toEqual({ reclaimed: true });
      expect(second).toEqual({ reclaimed: false });
      expect(await orderStatusOf(orders[0].id)).toBe('CANCELLED');
      expect(await stockOf(orders[0].variantId)).toEqual({
        stock: 10,
        reservedStock: 0,
      });
    });

    it('không đụng nhóm đã có Payment SUCCESS dù bị gọi nhầm', async () => {
      const { groupId, orders, txnRef, amount } = await setupGroup([
        { stock: 10, price: 40_000, quantity: 1 },
      ]);
      await service.confirmPayment(successCallback(txnRef, amount), 'IPN');

      const result = await service.reclaimCheckoutGroup(groupId);

      expect(result).toEqual({ reclaimed: false });
      expect(await orderStatusOf(orders[0].id)).toBe('PENDING');
      expect(await stockOf(orders[0].variantId)).toEqual({
        stock: 9,
        reservedStock: 0,
      });
    });
  });

  // 1.13: "1 callback thành công và 1 lượt thu hồi đồng thời trên cùng nhóm ⇒ đúng 1 bên thắng,
  // không deadlock" — chạy nhiều lần để tăng cơ hội bắt được cả 2 thứ tự thắng-thua.
  it('confirmPayment(SUCCESS) và reclaimCheckoutGroup chạy ĐỒNG THỜI trên cùng nhóm — đúng 1 bên thắng, không deadlock, trạng thái cuối luôn nhất quán', async () => {
    for (let i = 0; i < 5; i++) {
      const { groupId, orders, txnRef, amount } = await setupGroup([
        { stock: 10, price: 25_000, quantity: 2 },
      ]);

      const [confirmResult, reclaimResult] = await Promise.all([
        service.confirmPayment(successCallback(txnRef, amount), 'IPN'),
        service.reclaimCheckoutGroup(groupId),
      ]);

      const finalStatus = await orderStatusOf(orders[0].id);
      const finalStock = await stockOf(orders[0].variantId);

      if (confirmResult.outcome === 'CONFIRMED') {
        // confirmPayment thắng — chốt kho, đơn PENDING; reclaim tới sau thấy không còn gì để thu hồi.
        expect(finalStatus).toBe('PENDING');
        expect(finalStock).toEqual({ stock: 8, reservedStock: 0 });
        expect(reclaimResult).toEqual({ reclaimed: false });
      } else {
        // reclaim thắng trước — confirmPayment tới sau thấy đơn đã CANCELLED ⇒ ghi nhận muộn, KHÔNG
        // chốt kho lần nữa, KHÔNG hồi sinh đơn (1.4).
        expect(confirmResult.outcome).toBe('LATE_SUCCESS_RECORDED');
        expect(finalStatus).toBe('CANCELLED');
        expect(finalStock).toEqual({ stock: 10, reservedStock: 0 });
        expect(reclaimResult).toEqual({ reclaimed: true });
      }

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { txnRef },
      });
      // Cả 2 nhánh đều ghi nhận tiền thật đã vào — cổng là nguồn sự thật về tiền (1.10).
      expect(payment.status).toBe('SUCCESS');
    }
  });
});
