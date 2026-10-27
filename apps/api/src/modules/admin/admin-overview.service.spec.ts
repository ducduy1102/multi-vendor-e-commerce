import { adminOverviewSchema } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { RefundQueryService } from '../order/refund-query.service';
import { AdminOverviewService } from './admin-overview.service';

describe('AdminOverviewService', () => {
  let service: AdminOverviewService;
  let prisma: { shop: { count: jest.Mock } };
  let refundQueryService: { countOpenWork: jest.Mock };

  beforeEach(() => {
    prisma = { shop: { count: jest.fn().mockResolvedValue(0) } };
    refundQueryService = {
      countOpenWork: jest.fn().mockResolvedValue({
        escalatedRefundRequests: 0,
        refundsNeedingAction: 0,
        refundablePayments: 0,
      }),
    };
    service = new AdminOverviewService(
      prisma as unknown as PrismaService,
      refundQueryService as unknown as RefundQueryService,
    );
  });

  it('gộp số shop chờ duyệt với ba số của khu hoàn tiền thành đúng bốn trường của schema dùng chung', async () => {
    prisma.shop.count.mockResolvedValue(3);
    refundQueryService.countOpenWork.mockResolvedValue({
      escalatedRefundRequests: 1,
      refundsNeedingAction: 2,
      refundablePayments: 5,
    });

    const overview = await service.getOverview();

    expect(overview).toEqual({
      pendingShops: 3,
      escalatedRefundRequests: 1,
      refundsNeedingAction: 2,
      refundablePayments: 5,
    });
    // Không thừa trường nào mà FE không biết (z.object mặc định sẽ lặng lẽ cắt bỏ).
    expect(adminOverviewSchema.strict().safeParse(overview).success).toBe(true);
  });

  it('shop chờ duyệt = đếm PENDING, cùng điều kiện với danh sách /admin/shops mặc định', async () => {
    await service.getOverview();

    expect(prisma.shop.count).toHaveBeenCalledTimes(1);
    expect(prisma.shop.count).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
    });
  });

  it('các truy vấn độc lập chạy SONG SONG: truy vấn thứ hai được gọi trước khi truy vấn đầu xong', async () => {
    let releaseShops: (value: number) => void = () => undefined;
    prisma.shop.count.mockReturnValue(
      new Promise<number>((resolve) => {
        releaseShops = resolve;
      }),
    );

    const pending = service.getOverview();
    await Promise.resolve();

    expect(refundQueryService.countOpenWork).toHaveBeenCalledTimes(1);
    releaseShops(2);
    await expect(pending).resolves.toMatchObject({ pendingShops: 2 });
  });

  it('lỗi của một truy vấn lan ra, không trả số 0 sai', async () => {
    refundQueryService.countOpenWork.mockRejectedValue(new Error('db down'));

    await expect(service.getOverview()).rejects.toThrow('db down');
  });
});
