import { ConflictException, NotFoundException } from '@nestjs/common';
import { MAX_CART_LINES } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { VoucherService } from '../voucher/voucher.service';
import { CartService } from './cart.service';

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-1',
    stock: 10,
    reservedStock: 0,
    isActive: true,
    product: { status: 'PUBLISHED' },
    shop: { status: 'APPROVED' },
    ...overrides,
  };
}

describe('CartService', () => {
  let service: CartService;
  let voucherService: { validate: jest.Mock };
  let prisma: {
    cart: { findUnique: jest.Mock; upsert: jest.Mock };
    cartItem: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    productVariant: { findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      cart: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'cart-1' }),
      },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn((args: { create: { quantity: number } }) => ({
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: args.create.quantity,
        })),
        update: jest.fn((args: { data: { quantity: number } }) => ({
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: args.data.quantity,
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue(variantRow()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    voucherService = { validate: jest.fn() };
    service = new CartService(
      prisma as unknown as PrismaService,
      voucherService as unknown as VoucherService,
    );
  });

  describe('getCartItems', () => {
    it('user chưa có giỏ — trả mảng rỗng', async () => {
      await expect(service.getCartItems('user-1')).resolves.toEqual([]);
    });

    it('đọc theo userId và sắp xếp theo createdAt tăng dần', async () => {
      prisma.cart.findUnique.mockResolvedValue({ items: [{ id: 'i' }] });

      await service.getCartItems('user-1');

      const [args] = prisma.cart.findUnique.mock.calls[0] as [
        {
          where: { userId: string };
          select: { items: { orderBy: { createdAt: string } } };
        },
      ];
      expect(args.where).toEqual({ userId: 'user-1' });
      expect(args.select.items.orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  describe('quote / getCart / buildCartView', () => {
    function fullVariant(id: string, shopId: string) {
      return {
        id,
        price: { toNumber: () => 100000 },
        stock: 10,
        isActive: true,
        product: { id: `p-${id}`, name: id, slug: id, status: 'PUBLISHED' },
        shop: { id: shopId, name: shopId, slug: shopId, status: 'APPROVED' },
        images: [],
        attributeValues: [],
      };
    }

    it('giỏ rỗng — không query variant, trả view rỗng', async () => {
      const view = await service.quote([]);

      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      expect(view.shops).toEqual([]);
      expect(view.itemCount).toBe(0);
    });

    it('guest quote — gộp dòng trùng variant, id CartItem là null', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v1', 's1'),
      ]);

      const view = await service.quote([
        { productVariantId: 'v1', quantity: 1 },
        { productVariantId: 'v1', quantity: 2 },
      ]);

      expect(view.shops[0].items).toHaveLength(1);
      expect(view.shops[0].items[0].quantity).toBe(3);
      expect(view.shops[0].items[0].id).toBeNull();
      expect(view.subtotal).toBe('300000');
    });

    it('guest quote — bỏ qua thầm lặng variant không còn trong DB', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v1', 's1'),
      ]);

      const view = await service.quote([
        { productVariantId: 'gone', quantity: 1 },
        { productVariantId: 'v1', quantity: 1 },
      ]);

      expect(view.shops[0].items.map((i) => i.productVariantId)).toEqual([
        'v1',
      ]);
    });

    it('không có voucherCode (hoặc chỉ khoảng trắng) — không gọi validate, discount null', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v1', 's1'),
      ]);

      const view = await service.quote(
        [{ productVariantId: 'v1', quantity: 1 }],
        '   ',
      );

      expect(voucherService.validate).not.toHaveBeenCalled();
      expect(view.discount).toBeNull();
      expect(view.grandTotal).toBe('100000');
    });

    it('có voucherCode — gọi validate với view và userId, trừ discount vào grandTotal', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v1', 's1'),
      ]);
      voucherService.validate.mockResolvedValue({
        code: 'SALE10',
        shopId: null,
        amount: '10000',
      });

      const view = await service.quote(
        [{ productVariantId: 'v1', quantity: 2 }],
        'SALE10',
        'user-1',
      );

      expect(voucherService.validate).toHaveBeenCalledWith(
        'SALE10',
        expect.objectContaining({ subtotal: '200000' }),
        'user-1',
      );
      expect(view.subtotal).toBe('200000');
      expect(view.discount).toEqual({
        code: 'SALE10',
        shopId: null,
        amount: '10000',
      });
      expect(view.grandTotal).toBe('190000');
    });

    it('validate ném lỗi — lỗi được đẩy lên nguyên vẹn, không nuốt', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v1', 's1'),
      ]);
      const error = new Error('Voucher has expired');
      voucherService.validate.mockRejectedValue(error);

      await expect(
        service.quote([{ productVariantId: 'v1', quantity: 1 }], 'OLD'),
      ).rejects.toBe(error);
    });

    it('getCart — dựng từ CartItem của user, giữ id và thứ tự, nhóm theo shop', async () => {
      prisma.cart.findUnique.mockResolvedValue({
        items: [
          { id: 'i1', productVariantId: 'v1', quantity: 1 },
          { id: 'i2', productVariantId: 'v2', quantity: 2 },
        ],
      });
      prisma.productVariant.findMany.mockResolvedValue([
        fullVariant('v2', 's2'),
        fullVariant('v1', 's1'),
      ]);

      const view = await service.getCart('user-1');

      expect(view.shops.map((s) => s.shopId)).toEqual(['s1', 's2']);
      expect(view.shops[0].items[0].id).toBe('i1');
      expect(view.grandTotal).toBe('300000');
    });
  });

  describe('addItem', () => {
    it('thêm item mới — tạo Cart luôn kèm userId', async () => {
      const result = await service.addItem('user-1', 'variant-1', 2);

      expect(prisma.cart.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: { userId: 'user-1' },
        }),
      );
      expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            cartId: 'cart-1',
            productVariantId: 'variant-1',
            quantity: 2,
          },
        }),
      );
      expect(result.quantity).toBe(2);
    });

    it('variant đã có trong giỏ — cộng dồn quantity', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 3 });

      const result = await service.addItem('user-1', 'variant-1', 2);

      expect(result.quantity).toBe(5);
    });

    it('vượt stock — 409, không ghi DB', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(
        variantRow({ stock: 4 }),
      );
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 3 });

      await expect(service.addItem('user-1', 'variant-1', 2)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('đúng bằng stock — cho phép', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(
        variantRow({ stock: 5 }),
      );
      prisma.cartItem.findUnique.mockResolvedValue({ quantity: 3 });

      const result = await service.addItem('user-1', 'variant-1', 2);

      expect(result.quantity).toBe(5);
    });

    it('chặn theo available = stock - reservedStock, không phải stock vật lý', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(
        variantRow({ stock: 10, reservedStock: 8 }),
      );

      await expect(service.addItem('user-1', 'variant-1', 3)).rejects.toThrow(
        'Quantity exceeds available stock (2)',
      );
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();

      const result = await service.addItem('user-1', 'variant-1', 2);
      expect(result.quantity).toBe(2);
    });

    it('giữ chỗ hết sạch (available = 0) — không thêm được', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(
        variantRow({ stock: 5, reservedStock: 5 }),
      );

      await expect(service.addItem('user-1', 'variant-1', 1)).rejects.toThrow(
        ConflictException,
      );
    });

    describe('trần MAX_CART_LINES', () => {
      it.each([
        [MAX_CART_LINES - 1, true],
        [MAX_CART_LINES, false],
        [MAX_CART_LINES + 1, false],
      ])(
        'giỏ đang %i dòng, thêm dòng mới → cho phép = %s',
        async (lines, isAllowed) => {
          prisma.cartItem.count.mockResolvedValue(lines);

          const promise = service.addItem('user-1', 'variant-1', 1);

          if (isAllowed) {
            await expect(promise).resolves.toMatchObject({ quantity: 1 });
          } else {
            await expect(promise).rejects.toThrow(
              `Cart is full (max ${MAX_CART_LINES} items)`,
            );
            expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
          }
        },
      );

      it('giỏ đã đủ trần vẫn cộng dồn được vào dòng có sẵn', async () => {
        prisma.cartItem.count.mockResolvedValue(MAX_CART_LINES);
        prisma.cartItem.findUnique.mockResolvedValue({ quantity: 1 });

        const result = await service.addItem('user-1', 'variant-1', 2);

        expect(result.quantity).toBe(3);
        expect(prisma.cartItem.count).not.toHaveBeenCalled();
      });
    });

    it('variant không tồn tại — 404', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.addItem('user-1', 'nope', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['variant bị tắt', { isActive: false }],
      ['product không PUBLISHED', { product: { status: 'ARCHIVED' } }],
      ['shop chưa APPROVED', { shop: { status: 'SUSPENDED' } }],
    ])('%s — không cho thêm (409)', async (_label, override) => {
      prisma.productVariant.findUnique.mockResolvedValue(variantRow(override));

      await expect(service.addItem('user-1', 'variant-1', 1)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateItemQuantity', () => {
    it('tìm item theo id kèm điều kiện chủ giỏ, rồi cập nhật quantity', async () => {
      prisma.cartItem.findFirst.mockResolvedValue({
        productVariant: variantRow(),
      });

      const result = await service.updateItemQuantity('user-1', 'item-1', 4);

      expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1', cart: { userId: 'user-1' } },
        }),
      );
      expect(prisma.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: { quantity: 4 },
        }),
      );
      expect(result.quantity).toBe(4);
    });

    it('item không thuộc giỏ của user (hoặc không tồn tại) — 404', async () => {
      await expect(
        service.updateItemQuantity('user-1', 'item-x', 1),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('vượt stock — 409', async () => {
      prisma.cartItem.findFirst.mockResolvedValue({
        productVariant: variantRow({ stock: 3 }),
      });

      await expect(
        service.updateItemQuantity('user-1', 'item-1', 4),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('variant không còn khả dụng — 409', async () => {
      prisma.cartItem.findFirst.mockResolvedValue({
        productVariant: variantRow({ isActive: false }),
      });

      await expect(
        service.updateItemQuantity('user-1', 'item-1', 1),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateItemQuantity — kho giữ chỗ', () => {
    it('chặn theo available, không phải stock vật lý', async () => {
      prisma.cartItem.findFirst.mockResolvedValue({
        productVariant: variantRow({ stock: 10, reservedStock: 9 }),
      });

      await expect(
        service.updateItemQuantity('user-1', 'item-1', 2),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('xoá kèm điều kiện chủ giỏ, không lỗi khi không có item (idempotent)', async () => {
      await expect(
        service.removeItem('user-1', 'item-1'),
      ).resolves.toBeUndefined();

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'item-1', cart: { userId: 'user-1' } },
      });
    });
  });

  describe('mergeGuestCart', () => {
    function quantitiesWritten(): Record<string, number> {
      const calls = prisma.cartItem.upsert.mock.calls as Array<
        [{ create: { productVariantId: string; quantity: number } }]
      >;
      return Object.fromEntries(
        calls.map(([args]) => [
          args.create.productVariantId,
          args.create.quantity,
        ]),
      );
    }

    it('giỏ guest rỗng — không đụng DB', async () => {
      await service.mergeGuestCart('user-1', []);

      expect(prisma.cart.upsert).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cộng dồn với item đã có trong giỏ DB', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variantRow()]);
      prisma.cartItem.findMany.mockResolvedValue([
        { productVariantId: 'variant-1', quantity: 2 },
      ]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 3 },
      ]);

      expect(quantitiesWritten()).toEqual({ 'variant-1': 5 });
    });

    it('gộp các dòng trùng variant ngay trong payload', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variantRow()]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 1 },
        { productVariantId: 'variant-1', quantity: 2 },
      ]);

      expect(quantitiesWritten()).toEqual({ 'variant-1': 3 });
    });

    it('clamp theo stock thay vì lỗi', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variantRow({ stock: 4 }),
      ]);
      prisma.cartItem.findMany.mockResolvedValue([
        { productVariantId: 'variant-1', quantity: 3 },
      ]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 5 },
      ]);

      expect(quantitiesWritten()).toEqual({ 'variant-1': 4 });
    });

    it('bỏ qua variant không tồn tại, không lỗi cả request, vẫn merge phần còn lại', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variantRow()]);

      await expect(
        service.mergeGuestCart('user-1', [
          { productVariantId: 'gone', quantity: 1 },
          { productVariantId: 'variant-1', quantity: 2 },
        ]),
      ).resolves.toEqual({ droppedLineCount: 0 });

      expect(quantitiesWritten()).toEqual({ 'variant-1': 2 });
    });

    it('bỏ qua variant không khả dụng hoặc hết hàng', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variantRow({ id: 'off', isActive: false }),
        variantRow({ id: 'empty', stock: 0 }),
        variantRow({ id: 'ok' }),
      ]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'off', quantity: 1 },
        { productVariantId: 'empty', quantity: 1 },
        { productVariantId: 'ok', quantity: 1 },
      ]);

      expect(quantitiesWritten()).toEqual({ ok: 1 });
    });

    it('clamp theo available (stock - reservedStock)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variantRow({ stock: 10, reservedStock: 7 }),
      ]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 5 },
      ]);

      expect(quantitiesWritten()).toEqual({ 'variant-1': 3 });
    });

    describe('trần MAX_CART_LINES', () => {
      const guestLines = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          productVariantId: `g${i}`,
          quantity: 1,
        }));
      // findMany trả ngược thứ tự để chứng minh service tự sắp theo thứ tự dòng guest.
      const guestVariants = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          variantRow({ id: `g${i}` }),
        ).reverse();

      it('giỏ còn đủ chỗ — thêm hết, dropped = 0', async () => {
        prisma.cartItem.count.mockResolvedValue(10);
        prisma.productVariant.findMany.mockResolvedValue(guestVariants(3));

        const result = await service.mergeGuestCart('user-1', guestLines(3));

        expect(result).toEqual({ droppedLineCount: 0 });
        expect(Object.keys(quantitiesWritten())).toHaveLength(3);
      });

      it('vượt trần — thêm dòng guest theo thứ tự tới đủ trần, báo số dòng bỏ', async () => {
        prisma.cartItem.count.mockResolvedValue(MAX_CART_LINES - 2);
        prisma.productVariant.findMany.mockResolvedValue(guestVariants(5));

        const result = await service.mergeGuestCart('user-1', guestLines(5));

        expect(result).toEqual({ droppedLineCount: 3 });
        expect(Object.keys(quantitiesWritten()).sort()).toEqual(['g0', 'g1']);
      });

      it('giỏ đã đủ trần — dòng mới bị bỏ, dòng trùng với giỏ vẫn cộng dồn', async () => {
        prisma.cartItem.count.mockResolvedValue(MAX_CART_LINES);
        prisma.productVariant.findMany.mockResolvedValue([
          variantRow({ id: 'g1' }),
          variantRow({ id: 'g0' }),
        ]);
        prisma.cartItem.findMany.mockResolvedValue([
          { productVariantId: 'g0', quantity: 2 },
        ]);

        const result = await service.mergeGuestCart('user-1', guestLines(2));

        expect(result).toEqual({ droppedLineCount: 1 });
        expect(quantitiesWritten()).toEqual({ g0: 3 });
      });

      it('dòng không khả dụng/hết hàng bị bỏ thầm lặng: không tính vào dropped, không chiếm chỗ', async () => {
        prisma.cartItem.count.mockResolvedValue(MAX_CART_LINES - 1);
        prisma.productVariant.findMany.mockResolvedValue([
          variantRow({ id: 'g0', isActive: false }),
          variantRow({ id: 'g1', stock: 0 }),
          variantRow({ id: 'g2' }),
        ]);

        const result = await service.mergeGuestCart('user-1', guestLines(3));

        expect(result).toEqual({ droppedLineCount: 0 });
        expect(quantitiesWritten()).toEqual({ g2: 1 });
      });
    });

    it('Cart được tạo kèm userId (không bao giờ có Cart thiếu userId)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variantRow()]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 1 },
      ]);

      const [args] = prisma.cart.upsert.mock.calls[0] as [
        { where: unknown; create: unknown },
      ];
      expect(args.where).toEqual({ userId: 'user-1' });
      expect(args.create).toEqual({ userId: 'user-1' });
    });

    it('mọi thao tác ghi gộp trong đúng 1 $transaction (hoặc tất cả, hoặc không gì)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variantRow({ id: 'a' }),
        variantRow({ id: 'b' }),
      ]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'a', quantity: 1 },
        { productVariantId: 'b', quantity: 1 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [ops] = prisma.$transaction.mock.calls[0] as [unknown[]];
      expect(ops).toHaveLength(2);
    });

    it('variant chưa có trong giỏ DB — tạo mới đúng số lượng guest gửi', async () => {
      prisma.productVariant.findMany.mockResolvedValue([variantRow()]);

      await service.mergeGuestCart('user-1', [
        { productVariantId: 'variant-1', quantity: 4 },
      ]);

      expect(quantitiesWritten()).toEqual({ 'variant-1': 4 });
    });
  });
});
