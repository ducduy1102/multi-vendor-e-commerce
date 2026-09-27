import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { PaymentService } from './payment.service';
import { PaymentExpiryJob } from './payment-expiry.job';

const OLD_DATE = new Date('2020-01-01T00:00:00.000Z'); // luôn "đã hết hạn" bất kể ENV ân hạn là bao nhiêu

function pendingPaymentRow(checkoutGroupId: string) {
  return {
    checkoutGroupId,
    status: 'PENDING' as const,
    expiresAt: OLD_DATE,
    createdAt: OLD_DATE,
  };
}

describe('PaymentExpiryJob', () => {
  let prisma: {
    order: { findMany: jest.Mock };
    payment: { findMany: jest.Mock };
  };
  let paymentService: { reclaimCheckoutGroup: jest.Mock };
  let job: PaymentExpiryJob;

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    paymentService = {
      reclaimCheckoutGroup: jest.fn().mockResolvedValue({ reclaimed: true }),
    };
    job = new PaymentExpiryJob(
      prisma as unknown as PrismaService,
      paymentService as unknown as PaymentService,
    );
  });

  it('không có ứng viên nào — không gọi reclaimCheckoutGroup', async () => {
    await job.run();

    expect(paymentService.reclaimCheckoutGroup).not.toHaveBeenCalled();
  });

  it('gọi reclaimCheckoutGroup cho TỪNG ứng viên tìm được', async () => {
    prisma.order.findMany.mockResolvedValue([
      { checkoutGroupId: 'g1' },
      { checkoutGroupId: 'g2' },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      pendingPaymentRow('g1'),
      pendingPaymentRow('g2'),
    ]);

    await job.run();

    expect(paymentService.reclaimCheckoutGroup).toHaveBeenCalledTimes(2);
    expect(paymentService.reclaimCheckoutGroup).toHaveBeenCalledWith('g1');
    expect(paymentService.reclaimCheckoutGroup).toHaveBeenCalledWith('g2');
  });

  it('lỗi ở 1 nhóm KHÔNG chặn các nhóm khác trong cùng lượt', async () => {
    prisma.order.findMany.mockResolvedValue([
      { checkoutGroupId: 'g1' },
      { checkoutGroupId: 'g2' },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      pendingPaymentRow('g1'),
      pendingPaymentRow('g2'),
    ]);
    paymentService.reclaimCheckoutGroup
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce({ reclaimed: true });

    await expect(job.run()).resolves.toBeUndefined();

    expect(paymentService.reclaimCheckoutGroup).toHaveBeenCalledTimes(2);
  });

  it('lỗi bất ngờ khi tìm ứng viên — không ném ra ngoài (job vẫn sống cho lượt sau)', async () => {
    prisma.order.findMany.mockRejectedValue(new Error('DB down'));

    await expect(job.run()).resolves.toBeUndefined();
    expect(paymentService.reclaimCheckoutGroup).not.toHaveBeenCalled();
  });

  describe('cờ chống chạy chồng', () => {
    it('lượt thứ 2 tới khi lượt 1 chưa xong — bị bỏ qua, không đụng DB/không gọi reclaimCheckoutGroup', async () => {
      let resolveFindMany!: (value: unknown[]) => void;
      prisma.order.findMany.mockReturnValue(
        new Promise((resolve) => {
          resolveFindMany = resolve;
        }),
      );

      const firstRun = job.run(); // treo ở prisma.order.findMany (chưa resolve)
      const secondRun = job.run(); // isRunning đã true ngay từ đây — phải trả về ngay, không chờ

      await secondRun;
      expect(prisma.order.findMany).toHaveBeenCalledTimes(1); // lượt 2 chưa từng chạm DB

      resolveFindMany([]);
      await firstRun;

      expect(prisma.order.findMany).toHaveBeenCalledTimes(1); // vẫn chỉ 1 — đúng của lượt 1
      expect(paymentService.reclaimCheckoutGroup).not.toHaveBeenCalled();
    });

    it('sau khi 1 lượt xong, lượt tiếp theo chạy bình thường (cờ được nhả đúng)', async () => {
      await job.run();
      await job.run();

      expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
    });

    it('lượt trước lỗi vẫn nhả cờ đúng (finally) — lượt sau không bị kẹt', async () => {
      prisma.order.findMany.mockRejectedValueOnce(new Error('DB down'));
      await job.run();

      prisma.order.findMany.mockResolvedValueOnce([]);
      await job.run();

      expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
