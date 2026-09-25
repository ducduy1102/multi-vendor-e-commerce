import { BadRequestException, NotFoundException } from '@nestjs/common';
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
