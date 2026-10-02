import type { PrismaClient } from '@prisma/client';
import { findAutoCompleteCandidates } from './order-auto-complete-candidates';

const NOW = new Date('2026-10-10T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('findAutoCompleteCandidates', () => {
  let prisma: { order: { findMany: jest.Mock } };
  const asPrisma = () => prisma as unknown as PrismaClient;

  beforeEach(() => {
    prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } };
  });

  it('chỉ đơn SHIPPING mà mốc chuyển sang SHIPPING (từ history) đã quá N ngày — cutoff = now − N ngày', async () => {
    await findAutoCompleteCandidates(asPrisma(), {
      take: 50,
      now: NOW,
      days: 7,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: 'SHIPPING',
        statusHistory: {
          some: {
            toStatus: 'SHIPPING',
            createdAt: { lt: new Date(NOW.getTime() - 7 * DAY_MS) },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 50,
    });
  });

  it('số ngày khác nhau cho cutoff khác nhau', async () => {
    await findAutoCompleteCandidates(asPrisma(), {
      take: 10,
      now: NOW,
      days: 14,
    });

    const [args] = prisma.order.findMany.mock.calls[0] as [
      {
        where: {
          statusHistory: { some: { createdAt: { lt: Date } } };
        };
      },
    ];
    expect(args.where.statusHistory.some.createdAt.lt).toEqual(
      new Date(NOW.getTime() - 14 * DAY_MS),
    );
  });

  it('trả danh sách id đúng thứ tự truy vấn (cũ nhất trước)', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);

    await expect(
      findAutoCompleteCandidates(asPrisma(), { take: 50, now: NOW, days: 7 }),
    ).resolves.toEqual(['o1', 'o2']);
  });

  it('không có đơn nào — trả rỗng', async () => {
    await expect(
      findAutoCompleteCandidates(asPrisma(), { take: 50, now: NOW, days: 7 }),
    ).resolves.toEqual([]);
  });
});
