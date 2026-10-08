import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { RefundRequestActionService } from './refund-request-action.service';
import type { RefundService } from './refund.service';
import { RefundJob } from './refund.job';

interface StaleWhere {
  where: { attempts: { lt?: number; gte?: number } };
}

describe('RefundJob', () => {
  let prisma: {
    refundRequest: { findMany: jest.Mock };
    paymentRefund: { findMany: jest.Mock };
  };
  let actionService: { resolveOverdueRequest: jest.Mock };
  let refundService: {
    executeRefund: jest.Mock;
    failExhaustedRefund: jest.Mock;
  };
  let job: RefundJob;
  // "DB" giả cho hai truy vấn khoản hoàn bỏ dở: còn lượt thử (attempts < max) / hết lượt (attempts >= max).
  let retryable: { id: string }[];
  let exhausted: { id: string }[];

  beforeEach(() => {
    delete process.env.REFUND_MAX_ATTEMPTS;
    retryable = [];
    exhausted = [];
    prisma = {
      refundRequest: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRefund: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: StaleWhere) =>
            Promise.resolve(
              where.attempts.lt !== undefined ? retryable : exhausted,
            ),
          ),
      },
    };
    actionService = {
      resolveOverdueRequest: jest.fn().mockResolvedValue('APPROVED'),
    };
    refundService = {
      executeRefund: jest.fn().mockResolvedValue({}),
      failExhaustedRefund: jest.fn().mockResolvedValue(true),
    };
    job = new RefundJob(
      prisma as unknown as PrismaService,
      actionService as unknown as RefundRequestActionService,
      refundService as unknown as RefundService,
    );
  });

  afterEach(() => {
    delete process.env.REFUND_MAX_ATTEMPTS;
  });

  it('không có gì tới hạn — không gọi service nào', async () => {
    await job.run();

    expect(actionService.resolveOverdueRequest).not.toHaveBeenCalled();
    expect(refundService.executeRefund).not.toHaveBeenCalled();
    expect(refundService.failExhaustedRefund).not.toHaveBeenCalled();
  });

  describe('lượt 1 — yêu cầu quá hạn phản hồi của seller', () => {
    it('xử lý TỪNG yêu cầu quá hạn, truyền cùng một mốc "bây giờ" cho cả lô', async () => {
      prisma.refundRequest.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);

      await job.run();

      expect(actionService.resolveOverdueRequest).toHaveBeenCalledTimes(2);
      const [first, second] = actionService.resolveOverdueRequest.mock
        .calls as [[string, Date], [string, Date]];
      expect(first[0]).toBe('r1');
      expect(second[0]).toBe('r2');
      expect(first[1]).toBeInstanceOf(Date);
      expect(second[1]).toBe(first[1]);
    });

    it('chỉ tìm yêu cầu còn PENDING_SELLER đã quá hạn, tối đa 50 mỗi lượt', async () => {
      await job.run();

      const [args] = prisma.refundRequest.findMany.mock.calls[0] as [
        {
          where: { status: string; sellerRespondBy: { lt: Date } };
          take: number;
        },
      ];
      expect(args.where.status).toBe('PENDING_SELLER');
      expect(args.where.sellerRespondBy.lt).toBeInstanceOf(Date);
      expect(args.take).toBe(50);
    });

    it('1 yêu cầu lỗi KHÔNG chặn các yêu cầu còn lại — chỉ log rồi đi tiếp', async () => {
      prisma.refundRequest.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
        { id: 'r3' },
      ]);
      actionService.resolveOverdueRequest
        .mockResolvedValueOnce('APPROVED')
        .mockRejectedValueOnce(new Error('db timeout'))
        .mockResolvedValueOnce('ESCALATED');

      await expect(job.run()).resolves.toBeUndefined();

      expect(actionService.resolveOverdueRequest).toHaveBeenCalledTimes(3);
    });

    it('yêu cầu đã được xử lý nơi khác (trả null) — bình thường, không lỗi, vẫn đi tiếp', async () => {
      prisma.refundRequest.findMany.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);
      actionService.resolveOverdueRequest
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('ESCALATED');

      await expect(job.run()).resolves.toBeUndefined();

      expect(actionService.resolveOverdueRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('lượt 2 — khoản hoàn tiền PENDING bị bỏ dở', () => {
    it('khoản còn lượt thử ⇒ gọi lại executeRefund, KHÔNG đánh FAILED', async () => {
      retryable = [{ id: 'f1' }, { id: 'f2' }];

      await job.run();

      expect(refundService.executeRefund).toHaveBeenCalledTimes(2);
      expect(refundService.executeRefund).toHaveBeenCalledWith('f1');
      expect(refundService.executeRefund).toHaveBeenCalledWith('f2');
      expect(refundService.failExhaustedRefund).not.toHaveBeenCalled();
    });

    it('khoản hết lượt thử ⇒ failExhaustedRefund với số lần tối đa mặc định 3, KHÔNG gọi lại cổng', async () => {
      exhausted = [{ id: 'f9' }];

      await job.run();

      expect(refundService.failExhaustedRefund).toHaveBeenCalledWith('f9', 3);
      expect(refundService.executeRefund).not.toHaveBeenCalled();
    });

    it('REFUND_MAX_ATTEMPTS đọc LÚC CHẠY: dùng cho cả truy vấn lẫn lệnh đánh FAILED', async () => {
      process.env.REFUND_MAX_ATTEMPTS = '5';
      exhausted = [{ id: 'f9' }];

      await job.run();

      expect(refundService.failExhaustedRefund).toHaveBeenCalledWith('f9', 5);
      const calls = prisma.paymentRefund.findMany.mock.calls as [StaleWhere][];
      const wheres = calls.map(([args]) => args.where.attempts);
      expect(wheres).toEqual([{ lt: 5 }, { gte: 5 }]);
    });

    it('truy vấn chỉ lấy PENDING đã bỏ dở ít nhất 5 phút (không đụng lần gọi cổng đang chạy)', async () => {
      const before = Date.now();
      await job.run();

      const [args] = prisma.paymentRefund.findMany.mock.calls[0] as [
        {
          where: { status: string; updatedAt: { lt: Date } };
          take: number;
        },
      ];
      expect(args.where.status).toBe('PENDING');
      expect(args.take).toBe(50);
      const cutoff = args.where.updatedAt.lt.getTime();
      expect(before - cutoff).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
      expect(before - cutoff).toBeLessThan(5 * 60 * 1000 + 5000);
    });

    it('1 khoản lỗi KHÔNG chặn các khoản còn lại — vẫn đánh FAILED được khoản hết lượt', async () => {
      retryable = [{ id: 'f1' }, { id: 'f2' }];
      exhausted = [{ id: 'f9' }];
      refundService.executeRefund
        .mockRejectedValueOnce(new Error('db timeout'))
        .mockResolvedValueOnce({});

      await expect(job.run()).resolves.toBeUndefined();

      expect(refundService.executeRefund).toHaveBeenCalledTimes(2);
      expect(refundService.failExhaustedRefund).toHaveBeenCalledWith('f9', 3);
    });

    it('khoản hết lượt đã được chốt nơi khác (trả false) — bình thường, không lỗi', async () => {
      exhausted = [{ id: 'f8' }, { id: 'f9' }];
      refundService.failExhaustedRefund
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(job.run()).resolves.toBeUndefined();

      expect(refundService.failExhaustedRefund).toHaveBeenCalledTimes(2);
    });
  });

  describe('độc lập giữa hai lượt và giữa các lần chạy', () => {
    it('lượt 1 lỗi khi tìm ứng viên — lượt 2 VẪN chạy, job.run() không ném', async () => {
      prisma.refundRequest.findMany.mockRejectedValueOnce(new Error('db down'));
      retryable = [{ id: 'f1' }];

      await expect(job.run()).resolves.toBeUndefined();

      expect(refundService.executeRefund).toHaveBeenCalledWith('f1');
    });

    it('lượt 2 lỗi khi tìm ứng viên — job.run() không ném, lượt sau vẫn chạy được', async () => {
      prisma.paymentRefund.findMany.mockRejectedValueOnce(new Error('db down'));

      await expect(job.run()).resolves.toBeUndefined();

      prisma.refundRequest.findMany.mockResolvedValue([{ id: 'r1' }]);
      await job.run();
      expect(actionService.resolveOverdueRequest).toHaveBeenCalledTimes(1);
    });

    it('chống chạy chồng: lượt đang chạy dở thì lượt tới bị bỏ qua', async () => {
      prisma.refundRequest.findMany.mockResolvedValue([{ id: 'r1' }]);
      let release: () => void = () => undefined;
      actionService.resolveOverdueRequest.mockImplementation(
        () =>
          new Promise<'APPROVED'>((resolve) => {
            release = () => resolve('APPROVED');
          }),
      );

      const first = job.run();
      await new Promise((resolve) => setImmediate(resolve));
      await job.run(); // lượt 2 phải bị bỏ qua ngay
      expect(prisma.refundRequest.findMany).toHaveBeenCalledTimes(1);

      release();
      await first;

      // Xong lượt 1 thì lượt sau chạy lại được.
      prisma.refundRequest.findMany.mockResolvedValue([]);
      await job.run();
      expect(prisma.refundRequest.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
