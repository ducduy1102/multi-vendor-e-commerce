import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma, ShopStatus } from '@prisma/client';
import {
  canActorTransitionShop,
  SHOP_STATUS_TRANSITIONS,
  shopStatusSchema,
} from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { ShopStatusService } from '../shop/shop-status.service';
import { AdminService } from './admin.service';

// Matcher lồng trong object literal trả `any` — ép kiểu 1 lần ở đây thay vì để `any` rò rỉ ra từng chỗ
// dùng (@typescript-eslint/no-unsafe-assignment).
const anyDate = expect.any(Date) as unknown;
const containing = (fields: Record<string, unknown>) =>
  expect.objectContaining(fields) as unknown;

const SHOP_ID = 'shop-1';
const ADMIN_ID = 'admin-1';

// Hàng Prisma trả về cho 1 shop: ngoài field thường còn 2 khối THÔ `statusHistory` (dòng `→ REJECTED` mới
// nhất) và `_count.statusHistory` (số dòng `REJECTED → PENDING`) — AdminService phải gỡ chúng và đổi thành
// `lastRejectionReason` / `resubmissionCount`.
const shopRow = (
  overrides: Record<string, unknown> = {},
  rejectionNote: string | null | undefined = undefined,
  resubmitted = 0,
) => ({
  id: 'a',
  status: 'PENDING',
  statusHistory: rejectionNote === undefined ? [] : [{ note: rejectionNote }],
  _count: { statusHistory: resubmitted },
  ...overrides,
});

describe('AdminService', () => {
  let service: AdminService;
  const prisma = {
    shop: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn<Promise<unknown>, [Prisma.ShopFindManyArgs]>(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    shopStatusHistory: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  // ShopStatusService là THẬT (không mock): AdminService chỉ điều phối nên điều cần chứng minh ở đây là
  // luật cạnh + actor ADMIN và các thao tác DB mà nó sinh ra; tx của $transaction chính là mock prisma.
  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(prisma),
    );
    prisma.shopStatusHistory.create.mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        ShopStatusService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminService);
  });

  describe('listShops', () => {
    beforeEach(() => {
      prisma.shop.findMany.mockResolvedValue([shopRow()]);
      prisma.shop.count.mockResolvedValue(41);
    });

    it('lọc đúng trạng thái, phân trang bằng skip/take, trả total/page/limit', async () => {
      const result = await service.listShops({
        status: 'APPROVED',
        page: 3,
        limit: 20,
      });

      expect(prisma.shop.findMany).toHaveBeenCalledWith(
        containing({
          where: { status: 'APPROVED' },
          skip: 40,
          take: 20,
        }),
      );
      expect(prisma.shop.count).toHaveBeenCalledWith({
        where: { status: 'APPROVED' },
      });
      expect(result).toEqual({
        items: [
          {
            id: 'a',
            status: 'PENDING',
            lastRejectionReason: null,
            resubmissionCount: 0,
          },
        ],
        total: 41,
        page: 3,
        limit: 20,
      });
    });

    it('hàng chờ duyệt (PENDING): xếp theo MỐC VÀO HÀNG CHỜ (statusChangedAt) cũ nhất trước — shop nộp lại không nhảy lên đầu hàng dù createdAt cũ; id làm tie-break', async () => {
      await service.listShops({ status: 'PENDING', page: 1, limit: 20 });

      expect(prisma.shop.findMany).toHaveBeenCalledWith(
        containing({
          orderBy: [{ statusChangedAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it.each<ShopStatus>(['APPROVED', 'REJECTED', 'SUSPENDED'])(
      'trạng thái %s: lần đổi TRẠNG THÁI gần nhất trước (không phải updatedAt — nó đổi cả khi chủ shop sửa thông tin), id làm tie-break',
      async (status) => {
        await service.listShops({ status, page: 1, limit: 20 });

        expect(prisma.shop.findMany).toHaveBeenCalledWith(
          containing({
            orderBy: [{ statusChangedAt: 'desc' }, { id: 'desc' }],
          }),
        );
      },
    );

    it('có select chủ shop (name + email) nhưng không select passwordHash/role...', async () => {
      await service.listShops({ status: 'PENDING', page: 1, limit: 20 });

      const [args] = prisma.shop.findMany.mock.calls[0];
      expect(args.select?.owner).toEqual({
        select: { name: true, email: true },
      });
    });

    describe('lastRejectionReason / resubmissionCount suy từ ShopStatusHistory', () => {
      it('select đúng: 1 dòng `→ REJECTED` mới nhất (note) + đếm có lọc `REJECTED → PENDING`, cùng 1 truy vấn (không N+1)', async () => {
        await service.listShops({ status: 'PENDING', page: 1, limit: 20 });

        const [args] = prisma.shop.findMany.mock.calls[0];
        expect(args.select?.statusHistory).toEqual({
          where: { toStatus: 'REJECTED' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { note: true },
        });
        expect(args.select?._count).toEqual({
          select: {
            statusHistory: {
              where: { fromStatus: 'REJECTED', toStatus: 'PENDING' },
            },
          },
        });
        expect(prisma.shop.findMany).toHaveBeenCalledTimes(1);
      });

      it('shop từng bị từ chối và nộp lại 2 lần: trả lý do lần gần nhất + số lần', async () => {
        prisma.shop.findMany.mockResolvedValue([
          shopRow({}, 'Thiếu giấy phép', 2),
        ]);

        const { items } = await service.listShops({
          status: 'PENDING',
          page: 1,
          limit: 20,
        });

        expect(items[0]).toMatchObject({
          lastRejectionReason: 'Thiếu giấy phép',
          resubmissionCount: 2,
        });
      });

      it('shop chưa từng bị từ chối: null và 0', async () => {
        prisma.shop.findMany.mockResolvedValue([shopRow()]);

        const { items } = await service.listShops({
          status: 'PENDING',
          page: 1,
          limit: 20,
        });

        expect(items[0]).toMatchObject({
          lastRejectionReason: null,
          resubmissionCount: 0,
        });
      });

      it('dòng từ chối không có note (dữ liệu cũ) ⇒ null, không sập', async () => {
        prisma.shop.findMany.mockResolvedValue([shopRow({}, null, 0)]);

        const { items } = await service.listShops({
          status: 'REJECTED',
          page: 1,
          limit: 20,
        });

        expect(items[0].lastRejectionReason).toBeNull();
      });

      it('GỠ 2 khối thô statusHistory/_count khỏi response (không lộ field nội bộ)', async () => {
        prisma.shop.findMany.mockResolvedValue([shopRow({}, 'x', 1)]);

        const { items } = await service.listShops({
          status: 'PENDING',
          page: 1,
          limit: 20,
        });

        expect(items[0]).not.toHaveProperty('statusHistory');
        expect(items[0]).not.toHaveProperty('_count');
      });
    });
  });

  describe('updateShopStatus', () => {
    // Chỉ các cạnh ADMIN được phép; cạnh của OWNER (REJECTED → PENDING) nằm trong nhóm không hợp lệ
    // với Admin.
    const validEdges = SHOP_STATUS_TRANSITIONS.filter(
      (edge) => edge.actor === 'ADMIN',
    ).map((edge) => [edge.from, edge.to] as [ShopStatus, ShopStatus]);
    const allStatuses = shopStatusSchema.options as ShopStatus[];
    const invalidEdges = allStatuses.flatMap((from) =>
      allStatuses
        .filter((to) => !canActorTransitionShop('ADMIN', from, to))
        .map((to) => [from, to] as [ShopStatus, ShopStatus]),
    );

    beforeEach(() => {
      prisma.shop.updateMany.mockResolvedValue({ count: 1 });
      prisma.shop.findUniqueOrThrow.mockResolvedValue(shopRow({ id: SHOP_ID }));
    });

    it('shop không tồn tại — 404, không ghi gì', async () => {
      prisma.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shop.updateMany).not.toHaveBeenCalled();
    });

    it.each(validEdges)(
      'cạnh hợp lệ %s → %s: UPDATE có điều kiện status cũ',
      async (from, to) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: to as 'APPROVED' | 'REJECTED' | 'SUSPENDED',
          reason: 'lý do',
        });

        expect(prisma.shop.updateMany).toHaveBeenCalledWith({
          where: { id: SHOP_ID, status: from },
          data: {
            status: to,
            statusReason: to === 'APPROVED' ? null : 'lý do',
            statusChangedAt: anyDate,
          },
        });
      },
    );

    it.each(validEdges)(
      'cạnh hợp lệ %s → %s: ghi 1 dòng history với actor ADMIN = đúng admin đang thao tác, cùng giờ với statusChangedAt',
      async (from, to) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: to as 'APPROVED' | 'REJECTED' | 'SUSPENDED',
          reason: 'lý do',
        });

        expect(prisma.shopStatusHistory.create).toHaveBeenCalledTimes(1);
        const [{ data: history }] = prisma.shopStatusHistory.create.mock
          .calls[0] as [{ data: Record<string, unknown> }];
        const [{ data: update }] = prisma.shop.updateMany.mock.calls[0] as [
          { data: { statusChangedAt: Date } },
        ];
        expect(history).toEqual({
          shopId: SHOP_ID,
          fromStatus: from,
          toStatus: to,
          actorType: 'ADMIN',
          actorId: ADMIN_ID,
          note: to === 'APPROVED' ? null : 'lý do',
          createdAt: update.statusChangedAt,
        });
      },
    );

    it.each(invalidEdges)(
      'cạnh không hợp lệ %s → %s: 409 SHOP_INVALID_TRANSITION, không ghi gì',
      async (from, to) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await expectAppException(
          service.updateShopStatus(ADMIN_ID, SHOP_ID, {
            // Service nhận cả đích PENDING (ngoài kiểu của DTO) — schema chặn ở validate, service vẫn
            // phải an toàn nếu bị gọi thẳng.
            status: to as 'APPROVED',
            reason: 'lý do',
          }),
          {
            status: 409,
            code: 'SHOP_INVALID_TRANSITION',
            message: `Cannot change shop status from ${from} to ${to}`,
          },
        );
        expect(prisma.shop.updateMany).not.toHaveBeenCalled();
        expect(prisma.shopStatusHistory.create).not.toHaveBeenCalled();
      },
    );

    it('Admin KHÔNG làm được cạnh của chủ shop: REJECTED → PENDING bị 409 dù cạnh này có trong bảng chung', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'REJECTED' });

      await expectAppException(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: 'PENDING' as 'APPROVED',
        }),
        { status: 409, code: 'SHOP_INVALID_TRANSITION' },
      );
      expect(prisma.shop.updateMany).not.toHaveBeenCalled();
      expect(prisma.shopStatusHistory.create).not.toHaveBeenCalled();
    });

    it('từ chối/khoá: ghi lý do Admin nhập', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'SUSPENDED',
        reason: 'Vi phạm chính sách',
      });

      expect(prisma.shop.updateMany).toHaveBeenCalledWith({
        where: { id: SHOP_ID, status: 'APPROVED' },
        data: {
          status: 'SUSPENDED',
          statusReason: 'Vi phạm chính sách',
          statusChangedAt: anyDate,
        },
      });
    });

    it.each<[ShopStatus]>([['PENDING'], ['SUSPENDED']])(
      'duyệt/mở khoá từ %s: xoá lý do cũ, bỏ qua lý do gửi kèm',
      async (from) => {
        prisma.shop.findUnique.mockResolvedValue({ status: from });

        await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
          status: 'APPROVED',
          reason: 'không được lưu',
        });

        expect(prisma.shop.updateMany).toHaveBeenCalledWith({
          where: { id: SHOP_ID, status: from },
          data: {
            status: 'APPROVED',
            statusReason: null,
            statusChangedAt: anyDate,
          },
        });
        // Lý do gửi kèm bị bỏ qua ở cả history (note), không chỉ ở statusReason.
        expect(prisma.shopStatusHistory.create).toHaveBeenCalledWith({
          data: containing({ note: null }),
        });
      },
    );

    it('thua race (UPDATE không lật được dòng nào) — 409, không đọc lại shop', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'PENDING' });
      prisma.shop.updateMany.mockResolvedValue({ count: 0 });

      await expectAppException(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
        { status: 409, code: 'SHOP_INVALID_TRANSITION' },
      );
      expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
      // Thua race ⇒ không ghi history cho một lần chuyển không xảy ra.
      expect(prisma.shopStatusHistory.create).not.toHaveBeenCalled();
    });

    it('trả shop đọc lại sau khi ghi (kèm statusReason, chủ shop)', async () => {
      prisma.shop.findUnique.mockResolvedValue({ status: 'PENDING' });
      prisma.shop.findUniqueOrThrow.mockResolvedValue(
        shopRow(
          {
            id: SHOP_ID,
            status: 'REJECTED',
            statusReason: 'Thiếu thông tin',
            owner: { name: 'A', email: 'a@example.com' },
          },
          'Thiếu thông tin',
          0,
        ),
      );

      const result = await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'REJECTED',
        reason: 'Thiếu thông tin',
      });

      // Response của PATCH cũng có đủ 2 trường suy ra (FE parse bằng cùng adminShopSchema) và đã gỡ khối thô.
      expect(result).toEqual({
        id: SHOP_ID,
        status: 'REJECTED',
        statusReason: 'Thiếu thông tin',
        owner: { name: 'A', email: 'a@example.com' },
        lastRejectionReason: 'Thiếu thông tin',
        resubmissionCount: 0,
      });
      expect(prisma.shop.findUniqueOrThrow).toHaveBeenCalledWith(
        containing({ where: { id: SHOP_ID } }),
      );
    });

    it('log ai/shop nào/đổi từ đâu sang đâu, KHÔNG log lý do', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await service.updateShopStatus(ADMIN_ID, SHOP_ID, {
        status: 'SUSPENDED',
        reason: 'nội dung nhạy cảm',
      });

      expect(log).toHaveBeenCalledTimes(1);
      const message = String(log.mock.calls[0][0]);
      expect(message).toContain(ADMIN_ID);
      expect(message).toContain(SHOP_ID);
      expect(message).toContain('APPROVED -> SUSPENDED');
      expect(message).not.toContain('nội dung nhạy cảm');
      log.mockRestore();
    });

    it('không log khi đổi thất bại', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      prisma.shop.findUnique.mockResolvedValue({ status: 'APPROVED' });

      await expect(
        service.updateShopStatus(ADMIN_ID, SHOP_ID, { status: 'APPROVED' }),
      ).rejects.toBeDefined();

      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });
  });
});
