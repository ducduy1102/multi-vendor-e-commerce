import type { PrismaClient } from '@prisma/client';
import {
  findExhaustedStaleRefunds,
  findOverdueRefundRequests,
  findRetryableStaleRefunds,
} from './refund-job-candidates';

const NOW = new Date('2026-10-10T00:00:00.000Z');
const STALE_MS = 5 * 60 * 1000;

describe('findOverdueRefundRequests', () => {
  let prisma: { refundRequest: { findMany: jest.Mock } };
  const asPrisma = () => prisma as unknown as PrismaClient;

  beforeEach(() => {
    prisma = { refundRequest: { findMany: jest.fn().mockResolvedValue([]) } };
  });

  it('chỉ yêu cầu còn PENDING_SELLER mà hạn phản hồi đã qua (< now), quá hạn lâu nhất trước', async () => {
    await findOverdueRefundRequests(asPrisma(), { take: 50, now: NOW });

    expect(prisma.refundRequest.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_SELLER', sellerRespondBy: { lt: NOW } },
      orderBy: { sellerRespondBy: 'asc' },
      select: { id: true },
      take: 50,
    });
  });

  it('trả danh sách id đúng thứ tự truy vấn', async () => {
    prisma.refundRequest.findMany.mockResolvedValue([
      { id: 'r1' },
      { id: 'r2' },
    ]);

    await expect(
      findOverdueRefundRequests(asPrisma(), { take: 50, now: NOW }),
    ).resolves.toEqual(['r1', 'r2']);
  });

  it('không có yêu cầu nào — trả rỗng', async () => {
    await expect(
      findOverdueRefundRequests(asPrisma(), { take: 50, now: NOW }),
    ).resolves.toEqual([]);
  });
});

describe('khoản hoàn PENDING bị bỏ dở', () => {
  let prisma: { paymentRefund: { findMany: jest.Mock } };
  const asPrisma = () => prisma as unknown as PrismaClient;
  const query = { take: 50, now: NOW, staleMs: STALE_MS, maxAttempts: 3 };
  const staleCutoff = new Date(NOW.getTime() - STALE_MS);

  beforeEach(() => {
    prisma = { paymentRefund: { findMany: jest.fn().mockResolvedValue([]) } };
  });

  describe('findRetryableStaleRefunds', () => {
    it('PENDING, updatedAt cũ hơn ngưỡng bỏ dở (now − staleMs), CÒN lượt thử (attempts < max), cũ nhất trước', async () => {
      await findRetryableStaleRefunds(asPrisma(), query);

      expect(prisma.paymentRefund.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          attempts: { lt: 3 },
          updatedAt: { lt: staleCutoff },
        },
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
        take: 50,
      });
    });

    it('số lần thử tối đa khác nhau cho điều kiện khác nhau', async () => {
      await findRetryableStaleRefunds(asPrisma(), { ...query, maxAttempts: 5 });

      const [args] = prisma.paymentRefund.findMany.mock.calls[0] as [
        { where: { attempts: { lt: number } } },
      ];
      expect(args.where.attempts).toEqual({ lt: 5 });
    });

    it('trả danh sách id đúng thứ tự truy vấn', async () => {
      prisma.paymentRefund.findMany.mockResolvedValue([
        { id: 'f1' },
        { id: 'f2' },
      ]);

      await expect(
        findRetryableStaleRefunds(asPrisma(), query),
      ).resolves.toEqual(['f1', 'f2']);
    });
  });

  describe('findExhaustedStaleRefunds', () => {
    it('cùng điều kiện bỏ dở nhưng ĐÃ hết lượt thử (attempts >= max)', async () => {
      await findExhaustedStaleRefunds(asPrisma(), query);

      expect(prisma.paymentRefund.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          attempts: { gte: 3 },
          updatedAt: { lt: staleCutoff },
        },
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
        take: 50,
      });
    });

    it('trả danh sách id', async () => {
      prisma.paymentRefund.findMany.mockResolvedValue([{ id: 'f9' }]);

      await expect(
        findExhaustedStaleRefunds(asPrisma(), query),
      ).resolves.toEqual(['f9']);
    });
  });
});
