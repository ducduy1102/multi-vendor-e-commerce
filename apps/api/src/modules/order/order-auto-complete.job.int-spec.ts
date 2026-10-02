import {
  PrismaClient,
  type OrderStatus,
  type PaymentMethod,
} from '@prisma/client';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { InventoryService } from '../product/inventory.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { OrderActionService } from './order-action.service';
import { OrderAutoCompleteJob } from './order-auto-complete.job';
import { OrderEmailService } from './order-email.service';
import { OrderStatusService } from './order-status.service';
import { PaymentService } from './payment.service';

// Integration test trên DB dev THẬT: OrderAutoCompleteJob (Week8.md 1.7/2.9) chạy end-to-end qua
// job.run() thật — chọn đúng đơn theo MỐC GIAO HÀNG trong history, hoàn tất qua cùng đường với buyer bấm
// tay (kể cả thu tiền COD), idempotent, và không đánh nhau với buyer xác nhận cùng lúc. Chạy: `pnpm test:int`.
const TAG = 'it-auto-complete-';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('OrderAutoCompleteJob (DB thật)', () => {
  const prisma = new PrismaClient();
  const orderStatusService = new OrderStatusService();
  const inventoryService = new InventoryService();
  const orderEmailService = new OrderEmailService(
    prisma as unknown as PrismaService,
    createFakeMail().mailService,
  );
  const paymentService = new PaymentService(
    prisma as unknown as PrismaService,
    inventoryService,
    new VoucherUsageService(),
    new PaymentGatewayService(new VnpayProvider(), new MockPaymentProvider()),
    orderStatusService,
    orderEmailService,
  );
  const actionService = new OrderActionService(
    prisma as unknown as PrismaService,
    orderStatusService,
    inventoryService,
    paymentService,
    orderEmailService,
  );
  const job = new OrderAutoCompleteJob(
    prisma as unknown as PrismaService,
    actionService,
  );

  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
  const originalDays = process.env.ORDER_AUTO_COMPLETE_DAYS;

  beforeAll(async () => {
    process.env.ORDER_AUTO_COMPLETE_DAYS = '7';
    await cleanupByTag(prisma, TAG);
  });

  afterAll(async () => {
    if (originalDays === undefined) delete process.env.ORDER_AUTO_COMPLETE_DAYS;
    else process.env.ORDER_AUTO_COMPLETE_DAYS = originalDays;
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  interface SeedLine {
    status: OrderStatus;
    // Mốc chuyển sang SHIPPING ghi trong history; null = không có dòng SHIPPING nào.
    shippedAt: Date | null;
    // createdAt của chính đơn (mặc định xa trong quá khứ để chứng minh KHÔNG dùng nó làm mốc).
    orderCreatedAt?: Date;
  }

  async function seedGroup(lines: SeedLine[], method: PaymentMethod = 'VNPAY') {
    const user = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    const orderIds: string[] = [];
    for (const line of lines) {
      const base = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, base, { stock: 10 });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status: line.status,
          createdAt: line.orderCreatedAt ?? daysAgo(60),
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
                quantity: 1,
                priceAtPurchase: 100_000,
                productName: `${TAG}product`,
                sku: `SKU-${variant.id}`,
                variantLabel: null,
                imageUrl: null,
              },
            ],
          },
          statusHistory: {
            create: [
              {
                fromStatus: null,
                toStatus: 'PENDING',
                actorType: 'BUYER',
                createdAt: daysAgo(60),
              },
              ...(line.shippedAt
                ? [
                    {
                      fromStatus: 'PACKED' as const,
                      toStatus: 'SHIPPING' as const,
                      actorType: 'SELLER' as const,
                      createdAt: line.shippedAt,
                    },
                  ]
                : []),
            ],
          },
        },
        select: { id: true },
      });
      orderIds.push(order.id);
    }
    const payment = await prisma.payment.create({
      data: {
        checkoutGroupId: group.id,
        method,
        status: method === 'COD' ? 'PENDING' : 'SUCCESS',
        amount: 100_000 * lines.length,
        txnRef: `${TAG.toUpperCase()}${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        expiresAt: method === 'COD' ? null : new Date(Date.now() + 60_000),
      },
    });
    return {
      userId: user.id,
      groupId: group.id,
      orderIds,
      paymentId: payment.id,
    };
  }

  const statusOf = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const historyOf = (orderId: string) =>
    prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  const paymentStatusOf = async (id: string) =>
    (await prisma.payment.findUniqueOrThrow({ where: { id } })).status;

  it('đơn đã giao quá 7 ngày — tự COMPLETED bởi SYSTEM, ghi chú nêu số ngày; đơn mới giao hơn 7 ngày chưa tới thì giữ nguyên', async () => {
    const overdue = await seedGroup([
      { status: 'SHIPPING', shippedAt: daysAgo(8) },
    ]);
    const recent = await seedGroup([
      { status: 'SHIPPING', shippedAt: daysAgo(6) },
    ]);

    await job.run();

    expect(await statusOf(overdue.orderIds[0])).toBe('COMPLETED');
    const last = (await historyOf(overdue.orderIds[0])).at(-1);
    expect(last).toMatchObject({
      fromStatus: 'SHIPPING',
      toStatus: 'COMPLETED',
      actorType: 'SYSTEM',
      actorId: null,
    });
    expect(last?.note).toContain('7 day(s)');
    expect(await statusOf(recent.orderIds[0])).toBe('SHIPPING');
    expect(await historyOf(recent.orderIds[0])).toHaveLength(2); // mốc tạo + SHIPPING, không thêm gì
  });

  it('mốc tính từ lúc GIAO (history), không từ createdAt/updatedAt: đơn tạo từ rất lâu nhưng mới giao hôm qua thì chưa tự hoàn tất; đơn giao cách đây 8 ngày vẫn hoàn tất dù updatedAt vừa đổi', async () => {
    const shippedYesterday = await seedGroup([
      {
        status: 'SHIPPING',
        shippedAt: daysAgo(1),
        orderCreatedAt: daysAgo(90),
      },
    ]);
    const editedRecently = await seedGroup([
      { status: 'SHIPPING', shippedAt: daysAgo(8) },
    ]);
    // Seller sửa mã vận đơn gần đây ⇒ updatedAt = bây giờ.
    await prisma.order.update({
      where: { id: editedRecently.orderIds[0] },
      data: { trackingCode: 'NEW-CODE' },
    });

    await job.run();

    expect(await statusOf(shippedYesterday.orderIds[0])).toBe('SHIPPING');
    expect(await statusOf(editedRecently.orderIds[0])).toBe('COMPLETED');
  });

  it('chỉ đơn SHIPPING: đơn ở trạng thái khác dù có mốc giao cũ (đã hoàn tất, đã hủy, mới đóng gói) không bị đụng', async () => {
    const completed = await seedGroup([
      { status: 'COMPLETED', shippedAt: daysAgo(20) },
    ]);
    const cancelled = await seedGroup([
      { status: 'CANCELLED', shippedAt: daysAgo(20) },
    ]);
    const packed = await seedGroup([{ status: 'PACKED', shippedAt: null }]);

    await job.run();

    expect(await statusOf(completed.orderIds[0])).toBe('COMPLETED');
    expect(await statusOf(cancelled.orderIds[0])).toBe('CANCELLED');
    expect(await statusOf(packed.orderIds[0])).toBe('PACKED');
    expect(await historyOf(completed.orderIds[0])).toHaveLength(2);
  });

  it('chạy job 2 LẦN LIÊN TIẾP — lượt 2 là no-op sạch, đúng 1 dòng COMPLETED trong timeline', async () => {
    const g = await seedGroup([{ status: 'SHIPPING', shippedAt: daysAgo(9) }]);

    await job.run();
    await job.run();

    const completedRows = (await historyOf(g.orderIds[0])).filter(
      (h) => h.toStatus === 'COMPLETED',
    );
    expect(completedRows).toHaveLength(1);
  });

  it('đơn COD: job hoàn tất cả 2 đơn của nhóm ⇒ Payment COD → SUCCESS kèm paidAt (cùng đường với buyer bấm tay)', async () => {
    const g = await seedGroup(
      [
        { status: 'SHIPPING', shippedAt: daysAgo(8) },
        { status: 'SHIPPING', shippedAt: daysAgo(9) },
      ],
      'COD',
    );

    await job.run();

    for (const id of g.orderIds) expect(await statusOf(id)).toBe('COMPLETED');
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: g.paymentId },
    });
    expect(payment.status).toBe('SUCCESS');
    expect(payment.paidAt).not.toBeNull();
  });

  it('đơn COD trong nhóm còn đơn chưa quá hạn: hoàn tất đơn quá hạn nhưng CHƯA thu tiền (còn đơn đang giao)', async () => {
    const g = await seedGroup(
      [
        { status: 'SHIPPING', shippedAt: daysAgo(8) },
        { status: 'SHIPPING', shippedAt: daysAgo(2) },
      ],
      'COD',
    );

    await job.run();

    expect(await statusOf(g.orderIds[0])).toBe('COMPLETED');
    expect(await statusOf(g.orderIds[1])).toBe('SHIPPING');
    expect(await paymentStatusOf(g.paymentId)).toBe('PENDING');
  });

  it('RACE: buyer bấm "Đã nhận hàng" ĐỒNG THỜI với job — đơn COMPLETED đúng 1 lần, đúng 1 dòng timeline, không lỗi', async () => {
    for (let round = 0; round < 5; round++) {
      const g = await seedGroup([
        { status: 'SHIPPING', shippedAt: daysAgo(8) },
      ]);

      const results = await Promise.allSettled([
        actionService.confirmReceived(g.userId, g.orderIds[0]),
        job.run(),
      ]);

      // job.run() không bao giờ ném; buyer thua race thì nhận 409 ORDER_ALREADY_CHANGED/INVALID_TRANSITION.
      expect(results[1].status).toBe('fulfilled');
      expect(await statusOf(g.orderIds[0])).toBe('COMPLETED');
      const completedRows = (await historyOf(g.orderIds[0])).filter(
        (h) => h.toStatus === 'COMPLETED',
      );
      expect(completedRows).toHaveLength(1);
    }
  });

  it('số ngày lấy từ ORDER_AUTO_COMPLETE_DAYS lúc chạy', async () => {
    const g = await seedGroup([{ status: 'SHIPPING', shippedAt: daysAgo(4) }]);
    await job.run();
    expect(await statusOf(g.orderIds[0])).toBe('SHIPPING'); // 4 ngày < 7

    process.env.ORDER_AUTO_COMPLETE_DAYS = '3';
    try {
      await job.run();
    } finally {
      process.env.ORDER_AUTO_COMPLETE_DAYS = '7';
    }

    expect(await statusOf(g.orderIds[0])).toBe('COMPLETED');
  });
});
