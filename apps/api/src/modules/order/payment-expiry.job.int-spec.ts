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
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { PaymentExpiryJob } from './payment-expiry.job';
import { OrderStatusService } from './order-status.service';
import { PaymentService } from './payment.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy) — chứng minh PaymentExpiryJob (Week7.md
// 1.4/2.10) nối đúng findReclaimCandidates → PaymentService.reclaimCheckoutGroup end-to-end: nhả
// đúng reservedStock, huỷ đơn, VÀ hoàn lượt voucher — thứ mà payment.service.int-spec.ts (2.9) chưa
// từng dựng voucher nên chưa chứng minh được nhánh này qua DB thật. Chạy: `pnpm test:int`.
const TAG = 'it-expiry-job-';
const PAST = new Date(Date.now() - 60 * 60_000); // 1 giờ trước — chắc chắn quá mọi mức ân hạn hợp lý
const FUTURE = new Date(Date.now() + 60 * 60_000);

describe('PaymentExpiryJob (DB thật)', () => {
  const prisma = new PrismaClient();
  const inventoryService = new InventoryService();
  const voucherUsageService = new VoucherUsageService();
  const paymentGateway = new PaymentGatewayService(
    new VnpayProvider(),
    new MockPaymentProvider(),
  );
  const paymentService = new PaymentService(
    prisma as unknown as PrismaService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
    new OrderStatusService(),
  );
  const job = new PaymentExpiryJob(
    prisma as unknown as PrismaService,
    paymentService,
  );

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  async function setupGroup(expiresAt: Date, quantity = 2, stock = 10) {
    const user = await createUser(prisma, TAG);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, {
      stock,
      reservedStock: quantity,
      price: 50_000,
    });
    const group = await createCheckoutGroup(prisma, user.id);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: 'AWAITING_PAYMENT',
        totalAmount: 50_000 * quantity,
        recipientName: 'A',
        recipientPhone: '0900000000',
        shippingAddressLine: 'x',
        shippingWard: 'x',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: variant.id,
              quantity,
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
    const txnRef = `${TAG.toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method: 'VNPAY',
        amount: 50_000 * quantity,
        txnRef,
        expiresAt,
        createdAt: expiresAt,
      },
    });
    return {
      userId: user.id,
      groupId: group.id,
      orderId: order.id,
      variantId: variant.id,
    };
  }

  async function attachVoucherUsage(
    userId: string,
    checkoutGroupId: string,
    discountAmount: number,
  ) {
    const voucher = await prisma.voucher.create({
      data: {
        code: `${TAG.toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        type: 'FIXED',
        value: discountAmount,
        usedCount: 1,
      },
      select: { id: true },
    });
    await prisma.voucherUsage.create({
      data: { voucherId: voucher.id, userId, checkoutGroupId, discountAmount },
    });
    return voucher.id;
  }

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

  it('nhả reservedStock, huỷ đơn, VÀ hoàn lượt voucher — end-to-end qua job.run() thật', async () => {
    const { userId, groupId, orderId, variantId } = await setupGroup(
      PAST,
      2,
      10,
    );
    const voucherId = await attachVoucherUsage(userId, groupId, 15_000);

    await job.run();

    expect(await orderStatusOf(orderId)).toBe('CANCELLED');
    expect(await stockOf(variantId)).toEqual({ stock: 10, reservedStock: 0 });
    const usage = await prisma.voucherUsage.findFirstOrThrow({
      where: { checkoutGroupId: groupId },
    });
    expect(usage.releasedAt).not.toBeNull();
    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucherId },
    });
    expect(voucher.usedCount).toBe(0);
  });

  it('nhóm COD (đơn PENDING, Payment COD không hạn, tạo từ rất lâu) — job.run() KHÔNG BAO GIỜ thu hồi, kho/đơn/Payment nguyên vẹn', async () => {
    const user = await createUser(prisma, TAG);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 8 }); // đã chốt kho lúc đặt
    const group = await createCheckoutGroup(prisma, user.id);
    const old = new Date('2020-01-01T00:00:00.000Z');
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: 'PENDING',
        createdAt: old,
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
        txnRef: `${TAG.toUpperCase()}COD${Date.now().toString(36).toUpperCase()}`,
        expiresAt: null,
        createdAt: old,
      },
    });

    await job.run();

    expect(await orderStatusOf(order.id)).toBe('PENDING');
    expect(await stockOf(variant.id)).toEqual({ stock: 8, reservedStock: 0 });
    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(after.status).toBe('PENDING');
  });

  it('nhóm CHƯA hết hạn — job.run() không đụng tới', async () => {
    const { orderId, variantId } = await setupGroup(FUTURE, 1, 5);

    await job.run();

    expect(await orderStatusOf(orderId)).toBe('AWAITING_PAYMENT');
    expect(await stockOf(variantId)).toEqual({ stock: 5, reservedStock: 1 });
  });

  it('chạy job.run() 2 LẦN LIÊN TIẾP — không nhả 2 lần (usedCount không âm, reservedStock không âm)', async () => {
    const { userId, groupId, orderId, variantId } = await setupGroup(
      PAST,
      3,
      10,
    );
    await attachVoucherUsage(userId, groupId, 10_000);

    await job.run();
    await job.run(); // lượt 2: nhóm đã CANCELLED, không còn gì để nhả — phải là no-op sạch

    expect(await orderStatusOf(orderId)).toBe('CANCELLED');
    expect(await stockOf(variantId)).toEqual({ stock: 10, reservedStock: 0 });
    const usages = await prisma.voucherUsage.findMany({
      where: { checkoutGroupId: groupId },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0].releasedAt).not.toBeNull();
  });
});
