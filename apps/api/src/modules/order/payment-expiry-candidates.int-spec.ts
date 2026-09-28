import { PrismaClient } from '@prisma/client';
import {
  cleanupByTag,
  createCheckoutGroup,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';
import { findReclaimCandidates } from './payment-expiry-candidates';

// Integration test trên DB dev THẬT (cần Postgres đang chạy) — chứng minh câu truy vấn Prisma thật
// (distinct/orderBy/where in) của findReclaimCandidates (Week7.md 2.10) lọc đúng, thứ mà unit test
// với mock prisma không chứng minh được. Chạy: `pnpm test:int`.
const TAG = 'it-expiry-';
const NOW = new Date();
const GRACE_MS = 5 * 60_000;
const EXPIRED = new Date(NOW.getTime() - GRACE_MS - 60_000);
const NOT_EXPIRED = new Date(NOW.getTime() + 15 * 60_000);

describe('findReclaimCandidates (DB thật)', () => {
  const prisma = new PrismaClient();

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // Order không cần OrderItem cho test này (findReclaimCandidates chỉ đọc status/checkoutGroupId).
  async function setupGroup(
    orderStatus: 'AWAITING_PAYMENT' | 'PENDING' | 'CANCELLED',
    payments: Array<{
      status: 'PENDING' | 'FAILED' | 'SUCCESS';
      expiresAt: Date;
      createdAt: Date;
    }>,
  ) {
    const user = await createUser(prisma, TAG);
    const base = await createShopWithProduct(prisma, TAG);
    const group = await createCheckoutGroup(prisma, user.id);
    await prisma.order.create({
      data: {
        userId: user.id,
        shopId: base.shopId,
        checkoutGroupId: group.id,
        status: orderStatus,
        totalAmount: 100_000,
        recipientName: 'A',
        recipientPhone: '0900000000',
        shippingAddressLine: 'x',
        shippingWard: 'x',
        shippingProvince: 'Hồ Chí Minh',
      },
    });
    for (const [i, p] of payments.entries()) {
      await prisma.payment.create({
        data: {
          checkoutGroupId: group.id,
          method: 'VNPAY',
          status: p.status,
          amount: 100_000,
          txnRef:
            `${TAG.toUpperCase()}${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
          expiresAt: p.expiresAt,
          createdAt: p.createdAt,
        },
      });
    }
    return group.id;
  }

  it('lọc đúng: chỉ nhóm còn AWAITING_PAYMENT + chưa SUCCESS + lần thử mới nhất đã hết hạn+ân hạn', async () => {
    const eligible = await setupGroup('AWAITING_PAYMENT', [
      { status: 'PENDING', expiresAt: EXPIRED, createdAt: EXPIRED },
    ]);
    const notExpiredYet = await setupGroup('AWAITING_PAYMENT', [
      { status: 'PENDING', expiresAt: NOT_EXPIRED, createdAt: NOT_EXPIRED },
    ]);
    const alreadyPaid = await setupGroup('PENDING', [
      { status: 'SUCCESS', expiresAt: EXPIRED, createdAt: EXPIRED },
    ]);
    const alreadyCancelled = await setupGroup('CANCELLED', [
      { status: 'FAILED', expiresAt: EXPIRED, createdAt: EXPIRED },
    ]);
    const hasOldSuccessButNewFailedAttempt = await setupGroup(
      'AWAITING_PAYMENT',
      [
        {
          status: 'SUCCESS',
          expiresAt: EXPIRED,
          createdAt: new Date(EXPIRED.getTime() - 60_000),
        },
        { status: 'FAILED', expiresAt: EXPIRED, createdAt: EXPIRED },
      ],
    );

    const result = await findReclaimCandidates(prisma, {
      take: 100,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toContain(eligible);
    expect(result).not.toContain(notExpiredYet);
    expect(result).not.toContain(alreadyPaid);
    // alreadyCancelled: Order không còn AWAITING_PAYMENT nên không lọt vào ứng viên thô ngay từ đầu.
    expect(result).not.toContain(alreadyCancelled);
    expect(result).not.toContain(hasOldSuccessButNewFailedAttempt);
  });
});
