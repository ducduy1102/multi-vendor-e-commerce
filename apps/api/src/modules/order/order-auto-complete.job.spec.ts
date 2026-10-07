import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { OrderActionService } from './order-action.service';
import { OrderAutoCompleteJob } from './order-auto-complete.job';

describe('OrderAutoCompleteJob', () => {
  let prisma: { order: { findMany: jest.Mock } };
  let orderActionService: { autoCompleteShipped: jest.Mock };
  let job: OrderAutoCompleteJob;

  beforeEach(() => {
    delete process.env.ORDER_AUTO_COMPLETE_DAYS;
    prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } };
    orderActionService = {
      autoCompleteShipped: jest.fn().mockResolvedValue(true),
    };
    job = new OrderAutoCompleteJob(
      prisma as unknown as PrismaService,
      orderActionService as unknown as OrderActionService,
    );
  });

  afterEach(() => {
    delete process.env.ORDER_AUTO_COMPLETE_DAYS;
  });

  it('không có đơn quá hạn — không gọi hoàn tất', async () => {
    await job.run();

    expect(orderActionService.autoCompleteShipped).not.toHaveBeenCalled();
  });

  it('hoàn tất TỪNG đơn quá hạn, truyền số ngày mặc định 7', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);

    await job.run();

    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledTimes(2);
    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledWith(
      'o1',
      7,
    );
    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledWith(
      'o2',
      7,
    );
  });

  it('số ngày lấy từ ORDER_AUTO_COMPLETE_DAYS (đọc lúc chạy, không lúc khởi tạo)', async () => {
    process.env.ORDER_AUTO_COMPLETE_DAYS = '3';
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }]);

    await job.run();

    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledWith(
      'o1',
      3,
    );
  });

  it('1 đơn lỗi KHÔNG chặn các đơn còn lại — chỉ log rồi đi tiếp', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1' },
      { id: 'o2' },
      { id: 'o3' },
    ]);
    orderActionService.autoCompleteShipped
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce(true);

    await expect(job.run()).resolves.toBeUndefined();

    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledTimes(3);
  });

  it('đơn đã được xử lý nơi khác (trả false) — bình thường, không lỗi, vẫn đi tiếp', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);
    orderActionService.autoCompleteShipped
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(job.run()).resolves.toBeUndefined();

    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledTimes(2);
  });

  it('lỗi khi tìm ứng viên — job.run() KHÔNG ném (không làm sập tiến trình), lượt sau vẫn chạy được', async () => {
    prisma.order.findMany.mockRejectedValueOnce(new Error('db down'));

    await expect(job.run()).resolves.toBeUndefined();

    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }]);
    await job.run();
    expect(orderActionService.autoCompleteShipped).toHaveBeenCalledTimes(1);
  });

  it('chống chạy chồng: lượt đang chạy dở thì lượt tới bị bỏ qua', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }]);
    let release: () => void = () => undefined;
    orderActionService.autoCompleteShipped.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );

    const first = job.run();
    await new Promise((resolve) => setImmediate(resolve));
    await job.run(); // lượt 2 phải bị bỏ qua ngay
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);

    release();
    await first;

    // Xong lượt 1 thì lượt sau chạy lại được.
    prisma.order.findMany.mockResolvedValue([]);
    await job.run();
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });
});
