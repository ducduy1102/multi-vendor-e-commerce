import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CartView } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { CartService } from '../cart/cart.service';
import { InsufficientStockError } from '../product/inventory.service';
import type { InventoryService } from '../product/inventory.service';
import type { VoucherService } from '../voucher/voucher.service';
import type { VoucherUsageService } from '../voucher/voucher-usage.service';
import type { AddressService } from './address.service';
import type { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { CheckoutService, type PlaceOrderInput } from './checkout.service';
import { calculateShippingFee } from './shipping-rates';

const ADDRESS = {
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
};

function cartLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    productVariantId: 'variant-1',
    quantity: 2,
    productId: 'product-1',
    productName: 'Áo thun',
    productSlug: 'ao-thun',
    imageUrl: null,
    attributes: [],
    unitPrice: '100000',
    lineTotal: '200000',
    stock: 10,
    isAvailable: true,
    ...overrides,
  };
}

function cartView(
  shops: Array<{ shopId: string; items: unknown[] }>,
): CartView {
  return {
    shops: shops.map((s) => ({
      shopId: s.shopId,
      shopName: `Shop ${s.shopId}`,
      shopSlug: s.shopId,
      items: s.items as never,
      subtotal: '0',
    })),
    subtotal: '0',
    discount: null,
    grandTotal: '0',
    itemCount: 0,
  };
}

// Khác cartView() ở trên (subtotal cố định '0', đủ dùng cho placeOrder vì service đó không đọc
// field này — giá THẬT lấy từ inventoryService.reserve()) — preview() đọc THẲNG shop.subtotal/
// cartView.subtotal (không có bước khoá giá riêng) nên fixture này phải tính đúng, giống hệt
// composeCartView() thật (chỉ cộng item isAvailable).
function previewCartView(
  shops: Array<{ shopId: string; items: ReturnType<typeof cartLine>[] }>,
): CartView {
  const built = shops.map((s) => {
    const subtotal = s.items
      .filter((i) => i.isAvailable)
      .reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);
    return {
      shopId: s.shopId,
      shopName: `Shop ${s.shopId}`,
      shopSlug: s.shopId,
      items: s.items as never,
      subtotal: String(subtotal),
    };
  });
  const subtotal = built.reduce((sum, s) => sum + Number(s.subtotal), 0);
  return {
    shops: built,
    subtotal: String(subtotal),
    discount: null,
    grandTotal: String(subtotal),
    itemCount: shops.reduce((sum, s) => sum + s.items.length, 0),
  };
}

// Cân nặng mặc định của test (500g/sản phẩm, quantity 2) = đúng 1.000g cơ sở, không có bậc vượt —
// tính bằng ĐÚNG hàm thật (calculateShippingFee) thay vì đoán số, để không phải sửa tay mỗi khi đổi
// bảng giá mặc định. originProvince mặc định (readDefaultOriginProvince()) trùng ADDRESS.province
// nên luôn ra tuyến nội tỉnh.
const SHIPPING_FEE_2_ITEMS = calculateShippingFee({
  originProvince: 'Hồ Chí Minh',
  destinationProvince: ADDRESS.province,
  items: [{ weightGram: 500, quantity: 2 }],
});

const SUBTOTAL_1_LINE = 200_000; // unitPrice 100_000 × quantity 2

const INPUT: PlaceOrderInput = {
  addressId: 'addr-1',
  paymentMethod: 'VNPAY',
  expectedTotal: SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS,
};

describe('CheckoutService.placeOrder', () => {
  let service: CheckoutService;
  let prisma: {
    $transaction: jest.Mock;
    checkoutGroup: { findUnique: jest.Mock };
    order: { findMany: jest.Mock };
    payment: { update: jest.Mock };
    productVariant: { findMany: jest.Mock };
  };
  let tx: {
    cartItem: { deleteMany: jest.Mock };
    checkoutGroup: { create: jest.Mock };
    productVariant: { findMany: jest.Mock };
    voucher: { findUnique: jest.Mock };
    order: { findMany: jest.Mock };
  };
  let cartService: { getCartItems: jest.Mock; buildCartView: jest.Mock };
  let voucherService: { validate: jest.Mock };
  let voucherUsageService: { consume: jest.Mock };
  let inventoryService: { reserve: jest.Mock };
  let orderService: { createOrders: jest.Mock };
  let addressService: { getOwnedAddressOrThrow: jest.Mock };
  let paymentGateway: {
    availabilityOf: jest.Mock;
    getConfigured: jest.Mock;
    getAvailability: jest.Mock;
  };

  const variantMetaRow = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    sku: `SKU-${id}`,
    weightGram: 500,
    product: { name: `Product ${id}` },
    images: [{ url: `https://x/${id}.jpg` }],
    attributeValues: [
      { attributeValue: { value: 'Đỏ', attribute: { position: 0 } } },
      { attributeValue: { value: 'M', attribute: { position: 1 } } },
    ],
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      checkoutGroup: { create: jest.fn().mockResolvedValue({ id: 'group-1' }) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([variantMetaRow('variant-1')]),
      },
      voucher: { findUnique: jest.fn().mockResolvedValue(null) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
      checkoutGroup: { findUnique: jest.fn().mockResolvedValue(null) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { update: jest.fn().mockResolvedValue({}) },
      productVariant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'variant-1', weightGram: 500 }]),
      },
    };
    cartService = {
      getCartItems: jest
        .fn()
        .mockResolvedValue([
          { id: 'item-1', productVariantId: 'variant-1', quantity: 2 },
        ]),
      buildCartView: jest
        .fn()
        .mockResolvedValue(
          cartView([{ shopId: 'shop-1', items: [cartLine()] }]),
        ),
    };
    voucherService = { validate: jest.fn() };
    voucherUsageService = { consume: jest.fn().mockResolvedValue(undefined) };
    inventoryService = {
      reserve: jest
        .fn()
        .mockResolvedValue(
          new Map([['variant-1', new Prisma.Decimal(100_000)]]),
        ),
    };
    orderService = {
      createOrders: jest.fn().mockResolvedValue({
        orders: [
          {
            id: 'order-1',
            shopId: 'shop-1',
            status: 'AWAITING_PAYMENT',
            totalAmount: '220000',
          },
        ],
        paymentId: 'payment-1',
      }),
    };
    addressService = {
      getOwnedAddressOrThrow: jest.fn().mockResolvedValue(ADDRESS),
    };
    paymentGateway = {
      availabilityOf: jest
        .fn()
        .mockReturnValue({ method: 'VNPAY', available: true }),
      getConfigured: jest.fn().mockReturnValue({
        createPayment: jest
          .fn()
          .mockResolvedValue({ payUrl: 'https://pay.example/url' }),
      }),
      getAvailability: jest
        .fn()
        .mockReturnValue([{ method: 'VNPAY', available: true }]),
    };

    service = new CheckoutService(
      prisma as unknown as PrismaService,
      cartService as unknown as CartService,
      voucherService as unknown as VoucherService,
      voucherUsageService as unknown as VoucherUsageService,
      inventoryService as unknown as InventoryService,
      orderService,
      addressService as unknown as AddressService,
      paymentGateway as unknown as PaymentGatewayService,
    );
  });

  describe('đường vui vẻ — 1 shop, không voucher', () => {
    it('tạo đúng đơn, xoá giỏ đúng dòng, giữ chỗ đúng variant, trả kết quả đầy đủ', async () => {
      const result = await service.placeOrder('user-1', INPUT);

      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ id: 'item-1', quantity: 2 }] },
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(tx, [
        { productVariantId: 'variant-1', quantity: 2 },
      ]);
      expect(orderService.createOrders).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          checkoutGroupId: 'group-1',
          userId: 'user-1',
          voucherId: null,
          shipping: {
            recipientName: ADDRESS.recipientName,
            recipientPhone: ADDRESS.phone,
            shippingAddressLine: ADDRESS.line1,
            shippingWard: ADDRESS.ward,
            shippingProvince: ADDRESS.province,
          },
        }),
      );
      const [, orderArgs] = orderService.createOrders.mock.calls[0] as [
        unknown,
        {
          orders: Array<{
            items: Array<{ priceAtPurchase: number; productName: string }>;
          }>;
        },
      ];
      expect(orderArgs.orders[0].items[0]).toMatchObject({
        productVariantId: 'variant-1',
        productName: 'Product variant-1',
        variantLabel: 'Đỏ / M',
        sku: 'SKU-variant-1',
        priceAtPurchase: 100_000,
      });

      expect(result).toEqual({
        checkoutGroupId: 'group-1',
        orders: [
          {
            id: 'order-1',
            shopId: 'shop-1',
            status: 'AWAITING_PAYMENT',
            totalAmount: '220000', // từ orderService.createOrders (đã mock), không phải plan thật
          },
        ],
        // Từ plan.grandTotal THẬT (subtotal - discount + shippingFee), độc lập với fixture ở trên.
        totalAmount: String(SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS),
        paymentMethod: 'VNPAY',
        expiresAt: expect.any(String) as string,
        paymentUrl: 'https://pay.example/url',
      });
    });

    it('gọi cổng lấy payUrl SAU commit và lưu vào Payment.txnRef', async () => {
      await service.placeOrder('user-1', INPUT);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { txnRef: expect.any(String) as string },
        data: { payUrl: 'https://pay.example/url' },
      });
    });
  });

  describe('nhiều shop', () => {
    it('N đơn/1 payment, mỗi shop tính riêng', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 2 });
      cartService.buildCartView.mockResolvedValue(
        cartView([
          {
            shopId: 'shop-1',
            items: [cartLine({ id: 'item-1', productVariantId: 'variant-1' })],
          },
          {
            shopId: 'shop-2',
            items: [
              cartLine({
                id: 'item-2',
                productVariantId: 'variant-2',
                unitPrice: '50000',
              }),
            ],
          },
        ]),
      );
      tx.productVariant.findMany.mockResolvedValue([
        variantMetaRow('variant-1'),
        variantMetaRow('variant-2'),
      ]);
      inventoryService.reserve.mockResolvedValue(
        new Map([
          ['variant-1', new Prisma.Decimal(100_000)],
          ['variant-2', new Prisma.Decimal(50_000)],
        ]),
      );
      orderService.createOrders.mockResolvedValue({
        orders: [
          {
            id: 'order-1',
            shopId: 'shop-1',
            status: 'AWAITING_PAYMENT',
            totalAmount: '220000',
          },
          {
            id: 'order-2',
            shopId: 'shop-2',
            status: 'AWAITING_PAYMENT',
            totalAmount: '120000',
          },
        ],
        paymentId: 'payment-1',
      });

      const result = await service.placeOrder('user-1', {
        ...INPUT,
        // 2 shop, mỗi shop tự trả phí ship riêng (cùng cân nặng/số lượng nên cùng SHIPPING_FEE_2_ITEMS).
        expectedTotal: SUBTOTAL_1_LINE + 100_000 + 2 * SHIPPING_FEE_2_ITEMS,
      });

      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { id: 'item-1', quantity: 2 },
            { id: 'item-2', quantity: 2 },
          ],
        },
      });
      const [, orderArgs] = orderService.createOrders.mock.calls[0] as [
        unknown,
        { orders: Array<{ shopId: string }> },
      ];
      expect(orderArgs.orders.map((o) => o.shopId)).toEqual([
        'shop-1',
        'shop-2',
      ]);
      expect(result.orders).toHaveLength(2);
    });
  });

  describe('lọc dòng khả dụng (1.12)', () => {
    it('chỉ dòng isAvailable=true được mua — dòng không khả dụng không vào deleteMany/reserve', async () => {
      cartService.buildCartView.mockResolvedValue(
        cartView([
          {
            shopId: 'shop-1',
            items: [
              cartLine({
                id: 'item-1',
                productVariantId: 'variant-1',
                isAvailable: true,
              }),
              cartLine({
                id: 'item-2',
                productVariantId: 'variant-2',
                isAvailable: false,
              }),
            ],
          },
        ]),
      );

      await service.placeOrder('user-1', INPUT);

      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ id: 'item-1', quantity: 2 }] },
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(tx, [
        { productVariantId: 'variant-1', quantity: 2 },
      ]);
    });

    it('không còn dòng khả dụng nào — 400 NO_PURCHASABLE_ITEMS, không mở transaction', async () => {
      cartService.buildCartView.mockResolvedValue(
        cartView([
          { shopId: 'shop-1', items: [cartLine({ isAvailable: false })] },
        ]),
      );

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 400,
        code: 'NO_PURCHASABLE_ITEMS',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('giỏ rỗng — 400 NO_PURCHASABLE_ITEMS', async () => {
      cartService.buildCartView.mockResolvedValue(cartView([]));

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 400,
        code: 'NO_PURCHASABLE_ITEMS',
      });
    });
  });

  it('địa chỉ của người khác — 404, không đọc giỏ', async () => {
    addressService.getOwnedAddressOrThrow.mockRejectedValue(
      new NotFoundException('Address not found'),
    );

    await expect(service.placeOrder('user-1', INPUT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(cartService.getCartItems).not.toHaveBeenCalled();
  });

  describe('phương thức thanh toán không khả dụng', () => {
    it('kiểm TRƯỚC KHI giữ chỗ tồn kho — 409 kèm reason', async () => {
      paymentGateway.availabilityOf.mockReturnValue({
        method: 'VNPAY',
        available: false,
        reason: 'AMOUNT_TOO_LARGE',
      });

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        details: { method: 'VNPAY', reason: 'AMOUNT_TOO_LARGE' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('TOO_MANY_PENDING_CHECKOUTS', () => {
    it('vượt trần ở fail-fast — 409 kèm pendingGroupIds, không mở transaction', async () => {
      prisma.order.findMany.mockResolvedValue([
        { checkoutGroupId: 'g1' },
        { checkoutGroupId: 'g2' },
        { checkoutGroupId: 'g3' },
      ]);

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'TOO_MANY_PENDING_CHECKOUTS',
        details: { pendingGroupIds: ['g1', 'g2', 'g3'] },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('kiểm lại TRONG transaction (đã khoá theo user)', async () => {
      tx.order.findMany.mockResolvedValue([
        { checkoutGroupId: 'g1' },
        { checkoutGroupId: 'g2' },
        { checkoutGroupId: 'g3' },
      ]);

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'TOO_MANY_PENDING_CHECKOUTS',
      });
      expect(tx.checkoutGroup.create).not.toHaveBeenCalled();
    });
  });

  describe('CART_CHANGED', () => {
    it('xoá được ít dòng hơn đã đọc — 409, không tiếp tục giữ chỗ', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'CART_CHANGED',
      });
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });
  });

  describe('OUT_OF_STOCK', () => {
    it('InsufficientStockError → 409 kèm tên sản phẩm/available, rollback (không tạo Order)', async () => {
      inventoryService.reserve.mockRejectedValue(
        new InsufficientStockError([
          { productVariantId: 'variant-1', requested: 2, available: 1 },
        ]),
      );

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'OUT_OF_STOCK',
        details: {
          items: [
            {
              productVariantId: 'variant-1',
              productName: 'Product variant-1',
              variantLabel: 'Đỏ / M',
              available: 1,
            },
          ],
        },
      });
      expect(orderService.createOrders).not.toHaveBeenCalled();
    });
  });

  describe('PRICE_CHANGED', () => {
    it('grandTotal lệch expectedTotal — 409 kèm 2 số, không tạo Order', async () => {
      await expectAppException(
        service.placeOrder('user-1', { ...INPUT, expectedTotal: 999_999 }),
        {
          status: 409,
          code: 'PRICE_CHANGED',
          details: {
            expectedTotal: 999_999,
            currentTotal: SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS,
          },
        },
      );
      expect(orderService.createOrders).not.toHaveBeenCalled();
    });

    it('thiếu expectedTotal (0 không hợp lệ với subtotal thật) — vẫn phát hiện lệch', async () => {
      await expectAppException(
        service.placeOrder('user-1', { ...INPUT, expectedTotal: 0 }),
        {
          status: 409,
          code: 'PRICE_CHANGED',
        },
      );
    });
  });

  describe('voucher toàn sàn', () => {
    beforeEach(() => {
      tx.voucher.findUnique.mockResolvedValue({
        id: 'voucher-1',
        perUserLimit: 1,
      });
      voucherService.validate.mockResolvedValue({
        code: 'SALE10',
        shopId: null,
        amount: '20000',
      });
    });

    it('gọi VoucherService.validate với CartView dựng từ subtotal ĐÃ KHOÁ, không phải giỏ trước giao dịch', async () => {
      await service.placeOrder('user-1', {
        ...INPUT,
        voucherCode: 'SALE10',
        expectedTotal: SUBTOTAL_1_LINE - 20_000 + SHIPPING_FEE_2_ITEMS,
      });

      expect(voucherService.validate).toHaveBeenCalledWith(
        'SALE10',
        expect.objectContaining({
          subtotal: '200000',
          shops: [
            expect.objectContaining({ shopId: 'shop-1', subtotal: '200000' }),
          ] as unknown,
        }),
        'user-1',
      );
    });

    it('consume() theo đúng thứ tự tham số, discountAmount = số giảm đã tính', async () => {
      await service.placeOrder('user-1', {
        ...INPUT,
        voucherCode: 'SALE10',
        expectedTotal: SUBTOTAL_1_LINE - 20_000 + SHIPPING_FEE_2_ITEMS,
      });

      expect(voucherUsageService.consume).toHaveBeenCalledWith(tx, {
        voucherId: 'voucher-1',
        userId: 'user-1',
        checkoutGroupId: 'group-1',
        discountAmount: 20_000,
        perUserLimit: 1,
      });
    });

    it('voucherId gắn vào Order để truy vết (1.5)', async () => {
      await service.placeOrder('user-1', {
        ...INPUT,
        voucherCode: 'SALE10',
        expectedTotal: SUBTOTAL_1_LINE - 20_000 + SHIPPING_FEE_2_ITEMS,
      });

      const [, args] = orderService.createOrders.mock.calls[0] as [
        unknown,
        { voucherId: string | null },
      ];
      expect(args.voucherId).toBe('voucher-1');
    });

    it('voucher không active — lỗi từ VoucherService.validate được đẩy lên nguyên vẹn, rollback', async () => {
      voucherService.validate.mockRejectedValue(new Error('VOUCHER_INACTIVE'));

      await expect(
        service.placeOrder('user-1', { ...INPUT, voucherCode: 'SALE10' }),
      ).rejects.toThrow('VOUCHER_INACTIVE');
      expect(voucherUsageService.consume).not.toHaveBeenCalled();
      expect(orderService.createOrders).not.toHaveBeenCalled();
    });

    it('vượt perUserLimit — lỗi từ VoucherUsageService.consume được đẩy lên, không tạo Order', async () => {
      voucherUsageService.consume.mockRejectedValue(
        new Error('VOUCHER_PER_USER_LIMIT_REACHED'),
      );

      await expect(
        service.placeOrder('user-1', { ...INPUT, voucherCode: 'SALE10' }),
      ).rejects.toThrow('VOUCHER_PER_USER_LIMIT_REACHED');
      expect(orderService.createOrders).not.toHaveBeenCalled();
    });

    it('voucherCode chỉ khoảng trắng — coi như không có voucher', async () => {
      await service.placeOrder('user-1', { ...INPUT, voucherCode: '   ' });

      expect(voucherService.validate).not.toHaveBeenCalled();
      expect(voucherUsageService.consume).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency-Key', () => {
    it('có key và tra thấy nhóm cũ — trả lại kết quả cũ, không đọc giỏ/mở transaction', async () => {
      prisma.checkoutGroup.findUnique.mockResolvedValue({
        id: 'group-old',
        orders: [
          {
            id: 'order-old',
            shopId: 'shop-1',
            status: 'AWAITING_PAYMENT',
            totalAmount: '220000',
          },
        ],
        payments: [
          {
            method: 'VNPAY',
            amount: new Prisma.Decimal(220_000),
            expiresAt: new Date('2026-09-27T04:00:00Z'),
            payUrl: 'https://pay.example/old',
          },
        ],
      });

      const result = await service.placeOrder('user-1', INPUT, 'key-1');

      expect(result.checkoutGroupId).toBe('group-old');
      expect(result.paymentUrl).toBe('https://pay.example/old');
      expect(cartService.getCartItems).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.checkoutGroup.findUnique).toHaveBeenCalledWith({
        where: {
          userId_idempotencyKey: { userId: 'user-1', idempotencyKey: 'key-1' },
        },
        select: expect.any(Object) as unknown,
      });
    });

    it('CART_CHANGED khi có key — tra lại theo key, thấy nhóm đã tạo bởi request thắng cuộc → trả kết quả đó', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 0 });
      prisma.checkoutGroup.findUnique
        .mockResolvedValueOnce(null) // [0] chưa có lúc mới vào
        .mockResolvedValueOnce({
          id: 'group-won',
          orders: [
            {
              id: 'order-1',
              shopId: 'shop-1',
              status: 'AWAITING_PAYMENT',
              totalAmount: '220000',
            },
          ],
          payments: [
            {
              method: 'VNPAY',
              amount: new Prisma.Decimal(220_000),
              expiresAt: new Date('2026-09-27T04:00:00Z'),
              payUrl: null,
            },
          ],
        });

      const result = await service.placeOrder('user-1', INPUT, 'key-1');

      expect(result.checkoutGroupId).toBe('group-won');
      expect(prisma.checkoutGroup.findUnique).toHaveBeenCalledTimes(2);
    });

    it('CART_CHANGED khi có key nhưng tra lại KHÔNG thấy nhóm nào — vẫn báo lỗi thật', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 0 });
      prisma.checkoutGroup.findUnique.mockResolvedValue(null);

      await expectAppException(service.placeOrder('user-1', INPUT, 'key-1'), {
        status: 409,
        code: 'CART_CHANGED',
      });
    });

    it('CART_CHANGED khi KHÔNG có key — báo lỗi thật ngay, không tra lại', async () => {
      tx.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await expectAppException(service.placeOrder('user-1', INPUT), {
        status: 409,
        code: 'CART_CHANGED',
      });
      expect(prisma.checkoutGroup.findUnique).not.toHaveBeenCalled();
    });

    it('P2002 trên CheckoutGroup(userId, idempotencyKey) — tra lại rồi trả kết quả đã có, không lộ lỗi 500', async () => {
      tx.checkoutGroup.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: 'checkout_groups_user_id_idempotency_key_key' },
        }),
      );
      prisma.checkoutGroup.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'group-won',
          orders: [
            {
              id: 'order-1',
              shopId: 'shop-1',
              status: 'AWAITING_PAYMENT',
              totalAmount: '220000',
            },
          ],
          payments: [
            {
              method: 'VNPAY',
              amount: new Prisma.Decimal(220_000),
              expiresAt: new Date('2026-09-27T04:00:00Z'),
              payUrl: 'https://pay.example/won',
            },
          ],
        });

      const result = await service.placeOrder('user-1', INPUT, 'key-1');

      expect(result.checkoutGroupId).toBe('group-won');
    });

    it('P2002 trên model KHÁC (Payment.txnRef) — KHÔNG bị coi là idempotency race, báo lỗi thật', async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: 'payments_txn_ref_key' },
        },
      );
      orderService.createOrders.mockRejectedValue(error);

      await expect(service.placeOrder('user-1', INPUT, 'key-1')).rejects.toBe(
        error,
      );
      // Không tra lại thêm lần nào ngoài lần [0] ban đầu.
      expect(prisma.checkoutGroup.findUnique).toHaveBeenCalledTimes(1);
    });

    it('phát lại cùng key SAU THÀNH CÔNG (không có race) — vẫn trả lại đúng kết quả, không giữ chỗ thêm', async () => {
      // Lần 1: tạo thật.
      await service.placeOrder('user-1', INPUT, 'key-1');
      expect(inventoryService.reserve).toHaveBeenCalledTimes(1);

      // Lần 2: mô phỏng nhóm đã tồn tại.
      prisma.checkoutGroup.findUnique.mockResolvedValue({
        id: 'group-1',
        orders: [
          {
            id: 'order-1',
            shopId: 'shop-1',
            status: 'AWAITING_PAYMENT',
            totalAmount: '220000',
          },
        ],
        payments: [
          {
            method: 'VNPAY',
            amount: new Prisma.Decimal(220_000),
            expiresAt: new Date('2026-09-27T04:00:00Z'),
            payUrl: 'https://pay.example/url',
          },
        ],
      });

      const second = await service.placeOrder('user-1', INPUT, 'key-1');

      expect(second.checkoutGroupId).toBe('group-1');
      expect(inventoryService.reserve).toHaveBeenCalledTimes(1); // không tăng thêm
    });
  });

  describe('createPayUrlSafely', () => {
    it('cổng chưa cấu hình — paymentUrl null, không gọi payment.update', async () => {
      paymentGateway.getConfigured.mockReturnValue(null);

      const result = await service.placeOrder('user-1', INPUT);

      expect(result.paymentUrl).toBeNull();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('gateway.createPayment lỗi — KHÔNG rethrow, đơn vẫn trả về (AWAITING_PAYMENT), paymentUrl null', async () => {
      paymentGateway.getConfigured.mockReturnValue({
        createPayment: jest.fn().mockRejectedValue(new Error('gateway down')),
      });

      const result = await service.placeOrder('user-1', INPUT);

      expect(result.checkoutGroupId).toBe('group-1');
      expect(result.paymentUrl).toBeNull();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  // Nested trong cùng describe để tái dùng đúng service/mock đã dựng ở beforeEach (Week7.md 2.7b) —
  // preview() và placeOrder() cùng 1 CheckoutService instance.
  describe('preview (2.7b)', () => {
    it('1 shop, có địa chỉ, không voucher — subtotal/shippingFee/total khớp tính tay, không ghi DB', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
      );

      const result = await service.preview('user-1', { addressId: 'addr-1' });

      expect(addressService.getOwnedAddressOrThrow).toHaveBeenCalledWith(
        'user-1',
        'addr-1',
      );
      expect(result.needsAddress).toBe(false);
      expect(result.orders).toEqual([
        expect.objectContaining({
          shopId: 'shop-1',
          subtotal: String(SUBTOTAL_1_LINE),
          shippingFee: String(SHIPPING_FEE_2_ITEMS),
          discountAmount: '0',
          total: String(SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS),
        }) as unknown,
      ]);
      expect(result.subtotal).toBe(String(SUBTOTAL_1_LINE));
      expect(result.shippingTotal).toBe(String(SHIPPING_FEE_2_ITEMS));
      expect(result.discountTotal).toBe('0');
      expect(result.grandTotal).toBe(
        String(SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS),
      );
      expect(result.canPlaceOrder).toBe(true);
      expect(result.excludedItems).toEqual([]);
      expect(result.blockingIssues).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(voucherUsageService.consume).not.toHaveBeenCalled();
      expect(inventoryService.reserve).not.toHaveBeenCalled();
      expect(orderService.createOrders).not.toHaveBeenCalled();
    });

    it('chưa chọn địa chỉ — needsAddress true, KHÔNG đoán phí ship, không gọi AddressService/query weightGram', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
      );

      const result = await service.preview('user-1', {});

      expect(addressService.getOwnedAddressOrThrow).not.toHaveBeenCalled();
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      expect(result.needsAddress).toBe(true);
      expect(result.orders[0].shippingFee).toBeNull();
      expect(result.orders[0].total).toBeNull();
      expect(result.orders[0].subtotal).toBe(String(SUBTOTAL_1_LINE));
      expect(result.shippingTotal).toBeNull();
      expect(result.grandTotal).toBeNull();
    });

    it('địa chỉ không thuộc user — lỗi 404 được đẩy nguyên vẹn', async () => {
      addressService.getOwnedAddressOrThrow.mockRejectedValue(
        new NotFoundException('Address not found'),
      );
      cartService.buildCartView.mockResolvedValue(
        previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
      );

      await expect(
        service.preview('user-1', { addressId: 'addr-x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('giỏ rỗng — 400 NO_PURCHASABLE_ITEMS', async () => {
      cartService.buildCartView.mockResolvedValue(previewCartView([]));

      await expectAppException(service.preview('user-1', {}), {
        status: 400,
        code: 'NO_PURCHASABLE_ITEMS',
      });
    });

    it('không còn dòng khả dụng nào (toàn bộ isAvailable=false) — 400 NO_PURCHASABLE_ITEMS', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([
          { shopId: 'shop-1', items: [cartLine({ isAvailable: false })] },
        ]),
      );

      await expectAppException(service.preview('user-1', {}), {
        status: 400,
        code: 'NO_PURCHASABLE_ITEMS',
      });
    });

    it('item không khả dụng — vào excludedItems, không nằm trong order, không chặn canPlaceOrder', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([
          {
            shopId: 'shop-1',
            items: [
              cartLine({ id: 'item-1', productVariantId: 'variant-1' }),
              cartLine({
                id: 'item-2',
                productVariantId: 'variant-2',
                productName: 'Hết hàng',
                isAvailable: false,
              }),
            ],
          },
        ]),
      );

      const result = await service.preview('user-1', {});

      expect(result.excludedItems).toEqual([
        { cartItemId: 'item-2', name: 'Hết hàng', reason: 'UNAVAILABLE' },
      ]);
      expect(result.orders[0].items).toHaveLength(1);
      expect(result.orders[0].items[0].id).toBe('item-1');
      expect(result.canPlaceOrder).toBe(true);
    });

    it('dòng vượt tồn kho — vào blockingIssues, canPlaceOrder=false, KHÔNG tự loại/hạ số lượng khỏi đơn', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([
          {
            shopId: 'shop-1',
            items: [cartLine({ quantity: 5, stock: 2 })],
          },
        ]),
      );

      const result = await service.preview('user-1', {});

      expect(result.blockingIssues).toEqual([
        { cartItemId: 'item-1', type: 'INSUFFICIENT_STOCK', available: 2 },
      ]);
      expect(result.canPlaceOrder).toBe(false);
      expect(result.orders[0].items).toHaveLength(1);
    });

    describe('voucher toàn sàn', () => {
      it('chia theo allocateDiscount, validate() nhận ĐÚNG cartView thật (không dựng synthetic)', async () => {
        voucherService.validate.mockResolvedValue({
          code: 'SALE10',
          shopId: null,
          amount: '20000',
        });
        cartService.buildCartView.mockResolvedValue(
          previewCartView([
            {
              shopId: 'shop-1',
              items: [
                cartLine({
                  id: 'item-1',
                  productVariantId: 'variant-1',
                  unitPrice: '100000',
                  quantity: 1,
                }),
              ],
            },
            {
              shopId: 'shop-2',
              items: [
                cartLine({
                  id: 'item-2',
                  productVariantId: 'variant-2',
                  unitPrice: '300000',
                  quantity: 1,
                }),
              ],
            },
          ]),
        );

        const result = await service.preview('user-1', {
          voucherCode: 'SALE10',
        });

        expect(voucherService.validate).toHaveBeenCalledWith(
          'SALE10',
          expect.objectContaining({ subtotal: '400000' }),
          'user-1',
        );
        expect(
          result.orders.find((o) => o.shopId === 'shop-1')?.discountAmount,
        ).toBe('5000');
        expect(
          result.orders.find((o) => o.shopId === 'shop-2')?.discountAmount,
        ).toBe('15000');
        expect(result.discountTotal).toBe('20000');
        expect(result.discount).toEqual({
          code: 'SALE10',
          shopId: null,
          amount: '20000',
        });
      });
    });

    it('voucher theo shop — chỉ giảm đúng đơn của shop đó, đơn khác discountAmount=0', async () => {
      voucherService.validate.mockResolvedValue({
        code: 'SHOPSALE',
        shopId: 'shop-2',
        amount: '15000',
      });
      cartService.buildCartView.mockResolvedValue(
        previewCartView([
          {
            shopId: 'shop-1',
            items: [
              cartLine({
                id: 'item-1',
                productVariantId: 'variant-1',
                unitPrice: '100000',
                quantity: 1,
              }),
            ],
          },
          {
            shopId: 'shop-2',
            items: [
              cartLine({
                id: 'item-2',
                productVariantId: 'variant-2',
                unitPrice: '300000',
                quantity: 1,
              }),
            ],
          },
        ]),
      );

      const result = await service.preview('user-1', {
        voucherCode: 'SHOPSALE',
      });

      expect(
        result.orders.find((o) => o.shopId === 'shop-1')?.discountAmount,
      ).toBe('0');
      expect(
        result.orders.find((o) => o.shopId === 'shop-2')?.discountAmount,
      ).toBe('15000');
    });

    it('voucherCode chỉ khoảng trắng — coi như không có voucher, không gọi validate', async () => {
      cartService.buildCartView.mockResolvedValue(
        previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
      );

      const result = await service.preview('user-1', { voucherCode: '   ' });

      expect(voucherService.validate).not.toHaveBeenCalled();
      expect(result.discount).toBeNull();
    });

    describe('paymentMethods', () => {
      it('có địa chỉ — tính theo grandTotal (đã gồm phí ship)', async () => {
        cartService.buildCartView.mockResolvedValue(
          previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
        );

        await service.preview('user-1', { addressId: 'addr-1' });

        expect(paymentGateway.getAvailability).toHaveBeenCalledWith(
          SUBTOTAL_1_LINE + SHIPPING_FEE_2_ITEMS,
        );
      });

      it('chưa có địa chỉ — dùng subtotal đã trừ giảm giá (chưa cộng ship) làm số tạm', async () => {
        cartService.buildCartView.mockResolvedValue(
          previewCartView([{ shopId: 'shop-1', items: [cartLine()] }]),
        );

        await service.preview('user-1', {});

        expect(paymentGateway.getAvailability).toHaveBeenCalledWith(
          SUBTOTAL_1_LINE,
        );
      });
    });
  });
});
