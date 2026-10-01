import { PrismaClient, type OrderStatus } from '@prisma/client';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';
import { OrderStatusService } from './order-status.service';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh OrderStatusService
// (Week8.md 1.3/2.2) đúng ở mức mà unit test với mock không chứng minh được — câu UPDATE raw (ép kiểu
// enum, mảng id) chạy đúng trên Postgres thật, 2 transaction đồng thời chỉ 1 bên thắng, và nhiều đơn
// chồng lấn nhau không deadlock. Chạy: `pnpm test:int`.
const TAG = 'it-order-status-';

describe('OrderStatusService (DB thật)', () => {
  const prisma = new PrismaClient();
  const service = new OrderStatusService();

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  async function createOrders(count: number, status: OrderStatus) {
    const user = await createUser(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const base = await createShopWithProduct(prisma, TAG);
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          shopId: base.shopId,
          checkoutGroupId: group.id,
          status,
          totalAmount: 100_000,
          recipientName: 'Nguyễn Văn A',
          recipientPhone: '0912345678',
          shippingAddressLine: '12 Nguyễn Huệ',
          shippingWard: 'Phường Bến Nghé',
          shippingProvince: 'Hồ Chí Minh',
        },
        select: { id: true },
      });
      ids.push(order.id);
    }
    return { userId: user.id, ids };
  }

  const historyOf = (orderId: string) =>
    prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });

  const statusOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  it('lật nhiều đơn cùng lúc, cập nhật status + updatedAt và ghi history đủ từng đơn', async () => {
    const { ids } = await createOrders(3, 'PENDING');
    const before = await prisma.order.findUniqueOrThrow({
      where: { id: ids[0] },
    });

    const flipped = await prisma.$transaction((tx) =>
      service.transition(
        tx,
        ids,
        'PENDING',
        'CONFIRMED',
        { type: 'SELLER', id: 'seller-1' },
        'ok',
      ),
    );

    expect(flipped).toEqual([...ids].sort());
    for (const id of ids) {
      expect(await statusOf(id)).toBe('CONFIRMED');
      const history = await historyOf(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        actorType: 'SELLER',
        actorId: 'seller-1',
        note: 'ok',
      });
    }
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: ids[0] },
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
  });

  it('đơn không đúng trạng thái "từ" bị bỏ qua êm, không ghi history', async () => {
    const { ids } = await createOrders(2, 'PENDING');
    await prisma.order.update({
      where: { id: ids[1] },
      data: { status: 'CANCELLED' },
    });

    const flipped = await prisma.$transaction((tx) =>
      service.transition(tx, ids, 'PENDING', 'CONFIRMED', { type: 'SYSTEM' }),
    );

    expect(flipped).toEqual([ids[0]]);
    expect(await statusOf(ids[1])).toBe('CANCELLED');
    expect(await historyOf(ids[1])).toHaveLength(0);
  });

  it('transaction rollback — status và history cùng quay về, không dòng nào mồ côi', async () => {
    const { ids } = await createOrders(1, 'PENDING');

    await expect(
      prisma.$transaction(async (tx) => {
        await service.transition(tx, ids, 'PENDING', 'CONFIRMED', {
          type: 'SYSTEM',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await statusOf(ids[0])).toBe('PENDING');
    expect(await historyOf(ids[0])).toHaveLength(0);
  });

  it('race: buyer hủy và seller xác nhận CÙNG 1 đơn PENDING — đúng 1 bên thắng, đúng 1 dòng history', async () => {
    const { ids } = await createOrders(1, 'PENDING');

    const [cancelled, confirmed] = await Promise.all([
      prisma.$transaction((tx) =>
        service.transition(tx, ids, 'PENDING', 'CANCELLED', {
          type: 'BUYER',
          id: 'buyer-1',
        }),
      ),
      prisma.$transaction((tx) =>
        service.transition(tx, ids, 'PENDING', 'CONFIRMED', {
          type: 'SELLER',
          id: 'seller-1',
        }),
      ),
    ]);

    expect(cancelled.length + confirmed.length).toBe(1);
    const history = await historyOf(ids[0]);
    expect(history).toHaveLength(1);
    expect(await statusOf(ids[0])).toBe(history[0].toStatus);
  });

  it('race: 2 transaction chuyển cùng tập đơn theo thứ tự id khác nhau — không deadlock, đúng 1 bên lật đủ', async () => {
    const { ids } = await createOrders(6, 'PENDING');
    const reversed = [...ids].reverse();

    const results = await Promise.all([
      prisma.$transaction((tx) =>
        service.transition(tx, ids, 'PENDING', 'CONFIRMED', { type: 'SYSTEM' }),
      ),
      prisma.$transaction((tx) =>
        service.transition(tx, reversed, 'PENDING', 'CONFIRMED', {
          type: 'SYSTEM',
        }),
      ),
    ]);

    expect(results.map((r) => r.length).sort()).toEqual([0, 6]);
    for (const id of ids) {
      expect(await historyOf(id)).toHaveLength(1);
    }
  });

  it('recordCreated ghi mốc đầu fromStatus = null', async () => {
    const { userId, ids } = await createOrders(1, 'AWAITING_PAYMENT');

    await prisma.$transaction((tx) =>
      service.recordCreated(tx, [{ id: ids[0], status: 'AWAITING_PAYMENT' }], {
        type: 'BUYER',
        id: userId,
      }),
    );

    const history = await historyOf(ids[0]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'AWAITING_PAYMENT',
      actorType: 'BUYER',
      actorId: userId,
    });
  });
});
