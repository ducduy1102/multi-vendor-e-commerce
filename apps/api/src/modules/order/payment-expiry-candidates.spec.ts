import type { PrismaClient } from '@prisma/client';
import { findReclaimCandidates } from './payment-expiry-candidates';

const NOW = new Date('2026-09-27T10:00:00.000Z');
const GRACE_MS = 5 * 60_000;
const EXPIRED = new Date(NOW.getTime() - GRACE_MS - 60_000); // quá expiresAt + ân hạn
const WITHIN_GRACE = new Date(NOW.getTime() - GRACE_MS + 60_000); // quá expiresAt nhưng CÒN trong ân hạn
const NOT_EXPIRED = new Date(NOW.getTime() + 60_000);

describe('findReclaimCandidates', () => {
  let prisma: {
    order: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
  };
  // Cast qua PrismaClient đầy đủ (không phải Pick<...> hẹp) — cùng quy ước `asTx()` ở
  // voucher-usage.service.spec.ts: mock chỉ có `findMany` nhưng hàm chỉ gọi đúng field đó.
  const asPrisma = () => prisma as unknown as PrismaClient;

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
  });

  it('không có nhóm nào còn đơn AWAITING_PAYMENT — trả rỗng, không truy vấn Payment', async () => {
    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual([]);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('nhóm quá expiresAt + ân hạn, chưa có Payment SUCCESS — là ứng viên', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      {
        checkoutGroupId: 'g1',
        status: 'PENDING',
        expiresAt: EXPIRED,
        createdAt: EXPIRED,
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual(['g1']);
  });

  it('Payment không hết hạn (expiresAt = null, COD) — KHÔNG BAO GIỜ là ứng viên thu hồi', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      {
        checkoutGroupId: 'g1',
        status: 'PENDING',
        expiresAt: null,
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual([]);
  });

  it('nhóm còn trong ân hạn (đã quá expiresAt nhưng chưa quá ân hạn) — KHÔNG phải ứng viên', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      {
        checkoutGroupId: 'g1',
        status: 'PENDING',
        expiresAt: WITHIN_GRACE,
        createdAt: WITHIN_GRACE,
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual([]);
  });

  it('nhóm chưa hết hạn — KHÔNG phải ứng viên', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      {
        checkoutGroupId: 'g1',
        status: 'PENDING',
        expiresAt: NOT_EXPIRED,
        createdAt: NOT_EXPIRED,
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual([]);
  });

  it('nhóm đã có Payment SUCCESS (dù lần thử SAU đó FAILED và hết hạn) — KHÔNG bao giờ là ứng viên', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      // Payment mới nhất (createdAt lớn nhất) — FAILED, đã hết hạn từ lâu.
      {
        checkoutGroupId: 'g1',
        status: 'FAILED',
        expiresAt: EXPIRED,
        createdAt: new Date('2026-09-27T09:50:00.000Z'),
      },
      // Lần thử trước đó — SUCCESS (trường hợp hiếm, ≥2 Payment SUCCESS, Week7.md 1.4).
      {
        checkoutGroupId: 'g1',
        status: 'SUCCESS',
        expiresAt: EXPIRED,
        createdAt: new Date('2026-09-27T09:00:00.000Z'),
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual([]);
  });

  it('nhiều nhóm — chỉ lần thanh toán MỚI NHẤT (createdAt lớn nhất) của mỗi nhóm quyết định', async () => {
    prisma.order.findMany.mockResolvedValue([
      { checkoutGroupId: 'g1' },
      { checkoutGroupId: 'g2' },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      // g1: lần thử mới nhất (09:55) chưa hết hạn dù lần thử trước (09:00) đã hết hạn từ lâu.
      {
        checkoutGroupId: 'g1',
        status: 'FAILED',
        expiresAt: NOT_EXPIRED,
        createdAt: new Date('2026-09-27T09:55:00.000Z'),
      },
      {
        checkoutGroupId: 'g1',
        status: 'FAILED',
        expiresAt: EXPIRED,
        createdAt: new Date('2026-09-27T09:00:00.000Z'),
      },
      // g2: lần thử duy nhất đã hết hạn.
      {
        checkoutGroupId: 'g2',
        status: 'PENDING',
        expiresAt: EXPIRED,
        createdAt: EXPIRED,
      },
    ]);

    const result = await findReclaimCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(result).toEqual(['g2']);
  });

  it('truyền đúng `take` vào truy vấn Order, không truy vấn Payment ngoài các nhóm ứng viên thô', async () => {
    prisma.order.findMany.mockResolvedValue([{ checkoutGroupId: 'g1' }]);
    prisma.payment.findMany.mockResolvedValue([
      {
        checkoutGroupId: 'g1',
        status: 'PENDING',
        expiresAt: EXPIRED,
        createdAt: EXPIRED,
      },
    ]);

    await findReclaimCandidates(asPrisma(), {
      take: 7,
      now: NOW,
      graceMs: GRACE_MS,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'AWAITING_PAYMENT' },
        take: 7,
      }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { checkoutGroupId: { in: ['g1'] } },
      }),
    );
  });
});
