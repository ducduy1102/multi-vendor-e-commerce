import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CartView } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { VoucherService } from './voucher.service';

function cartView(): CartView {
  const group = (shopId: string, subtotal: string) => ({
    shopId,
    shopName: shopId,
    shopSlug: shopId,
    items: [],
    subtotal,
  });
  return {
    shops: [group('shop-a', '300000'), group('shop-b', '200000')],
    subtotal: '500000',
    discount: null,
    grandTotal: '500000',
    itemCount: 3,
  };
}

function voucherRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'voucher-1',
    code: 'SALE10',
    shopId: null,
    type: 'PERCENT',
    value: new Prisma.Decimal('10'),
    minOrderAmount: null,
    maxDiscountAmount: null,
    usageLimit: null,
    perUserLimit: null,
    usedCount: 0,
    isActive: true,
    expiresAt: null,
    ...overrides,
  };
}

describe('VoucherService.validate', () => {
  let service: VoucherService;
  let prisma: {
    voucher: { findUnique: jest.Mock };
    order: { count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      voucher: { findUnique: jest.fn().mockResolvedValue(voucherRow()) },
      order: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new VoucherService(prisma as unknown as PrismaService);
  });

  it('mã không tồn tại — 404', async () => {
    prisma.voucher.findUnique.mockResolvedValue(null);

    await expect(service.validate('NOPE', cartView())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('chuẩn hoá mã: bỏ khoảng trắng, viết hoa trước khi tra', async () => {
    await service.validate('  sale10 ', cartView());

    expect(prisma.voucher.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'SALE10' } }),
    );
  });

  it('voucher toàn sàn — tính trên tổng giỏ', async () => {
    const result = await service.validate('SALE10', cartView());

    expect(result).toEqual({
      code: 'SALE10',
      shopId: null,
      amount: '50000', // 10% × 500.000
    });
  });

  it('voucher theo shop — chỉ tính trên subtotal của đúng shop đó', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ shopId: 'shop-b' }),
    );

    const result = await service.validate('SALE10', cartView());

    expect(result.shopId).toBe('shop-b');
    expect(result.amount).toBe('20000'); // 10% × 200.000, không phải 500.000
  });

  it('voucher theo shop nhưng giỏ không có item của shop đó — báo rõ, không giảm 0 đồng', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ shopId: 'shop-z' }),
    );

    await expect(service.validate('SALE10', cartView())).rejects.toThrow(
      'Voucher does not apply to any item in your cart',
    );
  });

  it('giỏ không còn item khả dụng nào (subtotal 0) — không áp được', async () => {
    const empty: CartView = { ...cartView(), shops: [], subtotal: '0' };

    await expect(service.validate('SALE10', empty)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('voucher đang tắt — 400 với message riêng', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ isActive: false }),
    );

    await expect(service.validate('SALE10', cartView())).rejects.toThrow(
      'Voucher is not active',
    );
  });

  it('voucher hết hạn — 400 với message riêng', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.validate('SALE10', cartView())).rejects.toThrow(
      'Voucher has expired',
    );
  });

  it('chưa hết hạn — áp bình thường', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ expiresAt: new Date(Date.now() + 86400000) }),
    );

    await expect(service.validate('SALE10', cartView())).resolves.toBeDefined();
  });

  it('hết lượt dùng toàn hệ thống — 400 với message riêng', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ usageLimit: 5, usedCount: 5 }),
    );

    await expect(service.validate('SALE10', cartView())).rejects.toThrow(
      'Voucher usage limit has been reached',
    );
  });

  it('còn 1 lượt — vẫn áp được', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ usageLimit: 5, usedCount: 4 }),
    );

    await expect(service.validate('SALE10', cartView())).resolves.toBeDefined();
  });

  it('dưới minOrderAmount của cơ sở tính — 400, so đúng theo shop với voucher shop', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({
        shopId: 'shop-b',
        minOrderAmount: new Prisma.Decimal('250000'),
      }),
    );

    // Tổng giỏ 500k ≥ 250k nhưng subtotal shop-b chỉ 200k → phải bị chặn.
    await expect(service.validate('SALE10', cartView())).rejects.toThrow(
      'Order amount is below the voucher minimum',
    );
  });

  it('đúng bằng minOrderAmount — cho phép', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({ minOrderAmount: new Prisma.Decimal('500000') }),
    );

    await expect(service.validate('SALE10', cartView())).resolves.toBeDefined();
  });

  it('PERCENT có maxDiscountAmount — bị cap', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({
        value: new Prisma.Decimal('50'),
        maxDiscountAmount: new Prisma.Decimal('30000'),
      }),
    );

    const result = await service.validate('SALE10', cartView());

    expect(result.amount).toBe('30000');
  });

  it('FIXED — không bị cap bởi maxDiscountAmount', async () => {
    prisma.voucher.findUnique.mockResolvedValue(
      voucherRow({
        type: 'FIXED',
        value: new Prisma.Decimal('80000'),
        maxDiscountAmount: new Prisma.Decimal('10000'),
      }),
    );

    const result = await service.validate('SALE10', cartView());

    expect(result.amount).toBe('80000');
  });

  describe('perUserLimit', () => {
    beforeEach(() => {
      prisma.voucher.findUnique.mockResolvedValue(
        voucherRow({ perUserLimit: 1 }),
      );
    });

    it('guest (không có userId) — bỏ qua, không đếm Order (1.13)', async () => {
      await expect(
        service.validate('SALE10', cartView()),
      ).resolves.toBeDefined();
      expect(prisma.order.count).not.toHaveBeenCalled();
    });

    it('user đã dùng đủ số lần — 400', async () => {
      prisma.order.count.mockResolvedValue(1);

      await expect(
        service.validate('SALE10', cartView(), 'user-1'),
      ).rejects.toThrow('You have reached the usage limit for this voucher');
    });

    it('đếm đúng theo voucher + user, không tính đơn đã huỷ', async () => {
      await service.validate('SALE10', cartView(), 'user-1');

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          voucherId: 'voucher-1',
          userId: 'user-1',
          status: { not: 'CANCELLED' },
        },
      });
    });

    it('user chưa dùng lần nào — áp được', async () => {
      await expect(
        service.validate('SALE10', cartView(), 'user-1'),
      ).resolves.toBeDefined();
    });
  });

  it('chỉ đọc để preview — không ghi gì vào DB (không tăng usedCount)', async () => {
    const writes = { update: jest.fn(), updateMany: jest.fn() };
    (prisma.voucher as unknown as typeof writes).update = writes.update;
    (prisma.voucher as unknown as typeof writes).updateMany = writes.updateMany;

    await service.validate('SALE10', cartView());

    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.updateMany).not.toHaveBeenCalled();
  });
});

describe('VoucherService (seller)', () => {
  let service: VoucherService;
  let prisma: {
    voucher: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  function p2002(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { modelName: 'Voucher' },
    });
  }

  beforeEach(() => {
    prisma = {
      voucher: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 'new-voucher',
          ...args.data,
        })),
        update: jest.fn((args: { data: Record<string, unknown> }) => ({
          id: 'voucher-1',
          ...args.data,
        })),
      },
    };
    service = new VoucherService(prisma as unknown as PrismaService);
  });

  describe('createVoucher', () => {
    const dto = {
      code: ' summer-10 ',
      type: 'PERCENT' as const,
      value: 10,
    };

    it('gắn shopId từ tham số (đã qua guard), chuẩn hoá mã viết hoa', async () => {
      await service.createVoucher('shop-1', dto);

      const [args] = prisma.voucher.create.mock.calls[0] as [
        { data: { shopId: string; code: string } },
      ];
      expect(args.data.shopId).toBe('shop-1');
      expect(args.data.code).toBe('SUMMER-10');
    });

    it('trùng mã (P2002) — 409, không phải 500', async () => {
      prisma.voucher.create.mockRejectedValue(p2002());

      await expect(service.createVoucher('shop-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lỗi khác P2002 vẫn ném ra nguyên vẹn', async () => {
      const error = new Error('DB down');
      prisma.voucher.create.mockRejectedValue(error);

      await expect(service.createVoucher('shop-1', dto)).rejects.toBe(error);
    });

    it('ngày hết hạn ở quá khứ — 400, không ghi DB', async () => {
      await expect(
        service.createVoucher('shop-1', {
          ...dto,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.voucher.create).not.toHaveBeenCalled();
    });

    it('ngày hết hạn ở tương lai — được chuyển thành Date', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();

      await service.createVoucher('shop-1', { ...dto, expiresAt: future });

      const [args] = prisma.voucher.create.mock.calls[0] as [
        { data: { expiresAt: Date } },
      ];
      expect(args.data.expiresAt).toEqual(new Date(future));
    });
  });

  describe('listMyVouchers', () => {
    it('chỉ lấy voucher của đúng shop, mới nhất trước', async () => {
      await service.listMyVouchers('shop-1');

      const [args] = prisma.voucher.findMany.mock.calls[0] as [
        { where: unknown; orderBy: unknown },
      ];
      expect(args.where).toEqual({ shopId: 'shop-1' });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('setVoucherActive', () => {
    it('voucher thuộc shop — cập nhật đúng isActive', async () => {
      prisma.voucher.findFirst.mockResolvedValue({ id: 'voucher-1' });

      await service.setVoucherActive('shop-1', 'voucher-1', false);

      expect(prisma.voucher.findFirst).toHaveBeenCalledWith({
        where: { id: 'voucher-1', shopId: 'shop-1' },
        select: { id: true },
      });
      const [args] = prisma.voucher.update.mock.calls[0] as [
        { where: unknown; data: unknown },
      ];
      expect(args.where).toEqual({ id: 'voucher-1' });
      expect(args.data).toEqual({ isActive: false });
    });

    it('voucher của shop khác hoặc không tồn tại — 404, không update', async () => {
      await expect(
        service.setVoucherActive('shop-1', 'someone-elses', true),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.voucher.update).not.toHaveBeenCalled();
    });
  });
});
