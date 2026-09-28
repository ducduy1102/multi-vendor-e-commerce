import { PrismaClient } from '@prisma/client';
import {
  addCartItem,
  cleanupByTag,
  createAddress,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import { PaymentGatewayService } from '../../shared/payment/payment-gateway.service';
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import { CartService } from '../cart/cart.service';
import { InventoryService } from '../product/inventory.service';
import { OrderService } from '../order/order.service';
import { PaymentService } from '../order/payment.service';
import { VoucherService } from '../voucher/voucher.service';
import { VoucherUsageService } from '../voucher/voucher-usage.service';
import { AddressService } from './address.service';
import { CheckoutService, type PlaceOrderInput } from './checkout.service';
import { calculateShippingFee } from './shipping-rates';

// Integration test trên DB dev THẬT (cần Postgres đang chạy): chứng minh CheckoutService.placeOrder
// (Week7.md 2.7, "trái tim của tuần") đúng ở mức mà unit test với mock không chứng minh được —
// transaction thật sự nguyên tử (rollback không để lại gì dở dang) và Idempotency-Key thật sự chặn
// được 2 request đồng thời tạo trùng đơn. Chạy: `pnpm test:int`.
//
// Không cấu hình VNPAY_* nên PaymentGatewayService.getConfigured() luôn null ⇒ createPayUrlSafely
// không gọi mạng thật — đúng ý định (int-spec chỉ kiểm DB, không kiểm cổng thanh toán, xem
// vnpay.provider.spec.ts riêng).
const TAG = 'it-checkout-';
const ORIGIN = 'Hồ Chí Minh'; // = readDefaultOriginProvince() mặc định khi chưa cấu hình ENV

describe('CheckoutService.placeOrder (DB thật)', () => {
  const prisma = new PrismaClient();
  const voucherUsageService = new VoucherUsageService();
  const voucherService = new VoucherService(
    prisma as unknown as PrismaService,
    voucherUsageService,
  );
  const cartService = new CartService(
    prisma as unknown as PrismaService,
    voucherService,
  );
  const inventoryService = new InventoryService();
  const orderService = new OrderService();
  const addressService = new AddressService(prisma as unknown as PrismaService);
  const paymentGateway = new PaymentGatewayService(
    new VnpayProvider(),
    new MockPaymentProvider(),
  );
  const paymentService = new PaymentService(
    prisma as unknown as PrismaService,
    inventoryService,
    voucherUsageService,
    paymentGateway,
  );
  const checkoutService = new CheckoutService(
    prisma as unknown as PrismaService,
    cartService,
    voucherService,
    voucherUsageService,
    inventoryService,
    orderService,
    addressService,
    paymentGateway,
    paymentService,
  );

  const stockOf = (id: string) =>
    prisma.productVariant.findUniqueOrThrow({
      where: { id },
      select: { stock: true, reservedStock: true },
    });
  const cartItemCountOf = (userId: string) =>
    prisma.cartItem.count({ where: { cart: { userId } } });
  const shippingFeeFor = (weightGram: number, quantity: number) =>
    calculateShippingFee({
      originProvince: ORIGIN,
      destinationProvince: ORIGIN,
      items: [{ weightGram, quantity }],
    });

  // 1 user, 1 địa chỉ HCM, 1 shop có 1 variant tồn kho `stock`, 1 dòng giỏ số lượng `quantity`.
  async function setupSingleShopCart(quantity: number, stock: number) {
    const user = await createUser(prisma, TAG);
    const address = await createAddress(prisma, user.id);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, {
      stock,
      price: 100_000,
    });
    await addCartItem(prisma, user.id, variant.id, quantity);
    const expectedTotal = 100_000 * quantity + shippingFeeFor(500, quantity);
    return { user, address, shop: base, variant, expectedTotal };
  }

  const place = (
    userId: string,
    input: PlaceOrderInput,
    idempotencyKey?: string,
  ) => checkoutService.placeOrder(userId, input, idempotencyKey);

  beforeAll(() => cleanupByTag(prisma, TAG));

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  describe('đường vui vẻ', () => {
    it('tạo CheckoutGroup + Order + OrderItem + Payment, giữ chỗ tồn kho, xoá đúng dòng giỏ', async () => {
      const { user, address, variant, expectedTotal } =
        await setupSingleShopCart(2, 10);

      const result = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal,
      });

      expect(result.orders).toHaveLength(1);
      expect(result.totalAmount).toBe(String(expectedTotal));

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.orders[0].id },
        select: {
          status: true,
          totalAmount: true,
          checkoutGroupId: true,
          items: {
            select: {
              productVariantId: true,
              quantity: true,
              priceAtPurchase: true,
            },
          },
        },
      });
      expect(order.status).toBe('AWAITING_PAYMENT');
      expect(order.items).toHaveLength(1);
      expect(order.items[0].productVariantId).toBe(variant.id);
      expect(order.items[0].quantity).toBe(2);
      expect(order.items[0].priceAtPurchase.toString()).toBe('100000');

      const payments = await prisma.payment.findMany({
        where: { checkoutGroupId: order.checkoutGroupId },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        status: 'PENDING',
        amount: expect.anything() as unknown,
      });
      expect(payments[0].amount.toString()).toBe(String(expectedTotal));

      // Kho: giữ chỗ đúng số lượng, KHÔNG trừ kho vật lý (chỉ trừ khi thanh toán thành công, 2.9).
      expect(await stockOf(variant.id)).toEqual({
        stock: 10,
        reservedStock: 2,
      });

      // Giỏ: đúng dòng đã mua bị xoá.
      expect(await cartItemCountOf(user.id)).toBe(0);
    });

    it('nhiều shop — N Order nhưng ĐÚNG 1 Payment cho cả nhóm', async () => {
      const user = await createUser(prisma, TAG);
      const address = await createAddress(prisma, user.id);
      const baseA = await createShopWithProduct(prisma, TAG);
      const baseB = await createShopWithProduct(prisma, TAG);
      const variantA = await createVariant(prisma, baseA, {
        stock: 5,
        price: 100_000,
      });
      const variantB = await createVariant(prisma, baseB, {
        stock: 5,
        price: 50_000,
      });
      await addCartItem(prisma, user.id, variantA.id, 1);
      await addCartItem(prisma, user.id, variantB.id, 1);
      const expectedTotal =
        100_000 + shippingFeeFor(500, 1) + 50_000 + shippingFeeFor(500, 1);

      const result = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal,
      });

      expect(result.orders).toHaveLength(2);
      const payments = await prisma.payment.findMany({
        where: { checkoutGroupId: result.checkoutGroupId },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0].amount.toString()).toBe(String(expectedTotal));
    });
  });

  describe('rollback — không để lại gì dở dang (note-db.md mục 1)', () => {
    it('OUT_OF_STOCK: 1 trong 2 variant thiếu hàng → KHÔNG có CheckoutGroup/Order/Payment, KHÔNG giữ chỗ variant còn lại, giỏ nguyên vẹn', async () => {
      const user = await createUser(prisma, TAG);
      const address = await createAddress(prisma, user.id);
      const base = await createShopWithProduct(prisma, TAG);
      const ok = await createVariant(prisma, base, {
        stock: 10,
        price: 100_000,
      });
      const short = await createVariant(prisma, base, {
        stock: 1,
        price: 50_000,
      });
      await addCartItem(prisma, user.id, ok.id, 1);
      await addCartItem(prisma, user.id, short.id, 5); // vượt tồn kho

      const error = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal: 999_999_999, // không quan trọng (>= sàn thanh toán) — sẽ lỗi OUT_OF_STOCK trước khi tới bước so giá
      }).catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('OUT_OF_STOCK');
      expect(await stockOf(ok.id)).toEqual({ stock: 10, reservedStock: 0 });
      expect(await stockOf(short.id)).toEqual({ stock: 1, reservedStock: 0 });
      expect(await cartItemCountOf(user.id)).toBe(2); // giỏ KHÔNG bị xoá
      expect(
        await prisma.checkoutGroup.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
    });

    it('PRICE_CHANGED: expectedTotal sai → rollback toàn bộ (không giữ chỗ, không tạo nhóm, giỏ nguyên vẹn)', async () => {
      const { user, address, variant } = await setupSingleShopCart(2, 10);

      const error = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal: 999_999_999,
      }).catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('PRICE_CHANGED');
      expect(await stockOf(variant.id)).toEqual({
        stock: 10,
        reservedStock: 0,
      });
      expect(await cartItemCountOf(user.id)).toBe(1);
      expect(
        await prisma.checkoutGroup.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });

  describe('voucher toàn sàn', () => {
    async function createPlatformVoucher(
      overrides: Record<string, unknown> = {},
    ) {
      return prisma.voucher.create({
        data: {
          code: `${TAG.toUpperCase()}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          type: 'FIXED',
          value: 20_000,
          ...overrides,
        },
        select: { id: true, code: true },
      });
    }

    it('checkout 1 lần tách 2 Order chỉ tính ĐÚNG 1 lượt dùng; discountAmount = Σ Order.discountAmount', async () => {
      const user = await createUser(prisma, TAG);
      const address = await createAddress(prisma, user.id);
      const baseA = await createShopWithProduct(prisma, TAG);
      const baseB = await createShopWithProduct(prisma, TAG);
      const variantA = await createVariant(prisma, baseA, {
        stock: 5,
        price: 100_000,
      });
      const variantB = await createVariant(prisma, baseB, {
        stock: 5,
        price: 300_000,
      });
      await addCartItem(prisma, user.id, variantA.id, 1);
      await addCartItem(prisma, user.id, variantB.id, 1);
      const voucher = await createPlatformVoucher();
      const subtotal = 100_000 + 300_000;
      const shipping = shippingFeeFor(500, 1) * 2;
      const expectedTotal = subtotal - 20_000 + shipping;

      const result = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        voucherCode: voucher.code,
        expectedTotal,
      });

      expect(result.orders).toHaveLength(2);
      const usages = await prisma.voucherUsage.findMany({
        where: { voucherId: voucher.id },
      });
      expect(usages).toHaveLength(1);
      expect(usages[0].discountAmount.toString()).toBe('20000');

      const refreshedVoucher = await prisma.voucher.findUniqueOrThrow({
        where: { id: voucher.id },
      });
      expect(refreshedVoucher.usedCount).toBe(1);

      const orders = await prisma.order.findMany({
        where: { checkoutGroupId: result.checkoutGroupId },
        select: { discountAmount: true },
      });
      const totalDiscount = orders.reduce(
        (sum, o) => sum + Number(o.discountAmount),
        0,
      );
      expect(totalDiscount).toBe(20_000);
    });

    it('rollback (PRICE_CHANGED) không để lại VoucherUsage/usedCount tăng', async () => {
      const { user, address, variant } = await setupSingleShopCart(1, 10);
      const voucher = await createPlatformVoucher();

      const error = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        voucherCode: voucher.code,
        expectedTotal: 999_999_999, // sai có chủ đích (>= sàn thanh toán)
      }).catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('PRICE_CHANGED');
      expect(
        await prisma.voucherUsage.count({ where: { voucherId: voucher.id } }),
      ).toBe(0);
      const refreshed = await prisma.voucher.findUniqueOrThrow({
        where: { id: voucher.id },
      });
      expect(refreshed.usedCount).toBe(0);
      expect(await stockOf(variant.id)).toEqual({
        stock: 10,
        reservedStock: 0,
      });
    });
  });

  // 2.8 (d): voucher theo shop dùng CHUNG cơ chế VoucherUsageService với voucher toàn sàn — khác
  // biệt duy nhất là số giảm chỉ rơi vào đúng 1 Order (đơn của shop khác không bị đụng tới).
  describe('voucher theo shop', () => {
    it('chỉ giảm đúng đơn của shop đó — đơn shop khác discountAmount = 0, VoucherUsage vẫn đúng 1 bản ghi', async () => {
      const user = await createUser(prisma, TAG);
      const address = await createAddress(prisma, user.id);
      const baseA = await createShopWithProduct(prisma, TAG);
      const baseB = await createShopWithProduct(prisma, TAG);
      const variantA = await createVariant(prisma, baseA, {
        stock: 5,
        price: 100_000,
      });
      const variantB = await createVariant(prisma, baseB, {
        stock: 5,
        price: 300_000,
      });
      await addCartItem(prisma, user.id, variantA.id, 1);
      await addCartItem(prisma, user.id, variantB.id, 1);
      const voucher = await prisma.voucher.create({
        data: {
          shopId: baseB.shopId,
          code: `${TAG.toUpperCase()}SHOP${Date.now().toString(36).toUpperCase()}`,
          type: 'FIXED',
          value: 50_000,
        },
        select: { id: true, code: true },
      });
      const shipping = shippingFeeFor(500, 1) * 2;
      const expectedTotal = 100_000 + (300_000 - 50_000) + shipping;

      const result = await place(user.id, {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        voucherCode: voucher.code,
        expectedTotal,
      });

      expect(result.orders).toHaveLength(2);
      const orders = await prisma.order.findMany({
        where: { checkoutGroupId: result.checkoutGroupId },
        select: { shopId: true, discountAmount: true },
      });
      expect(
        orders
          .find((o) => o.shopId === baseA.shopId)
          ?.discountAmount.toString(),
      ).toBe('0');
      expect(
        orders
          .find((o) => o.shopId === baseB.shopId)
          ?.discountAmount.toString(),
      ).toBe('50000');

      const usages = await prisma.voucherUsage.findMany({
        where: { voucherId: voucher.id },
      });
      expect(usages).toHaveLength(1);
      expect(usages[0].discountAmount.toString()).toBe('50000');
      expect(
        (await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } }))
          .usedCount,
      ).toBe(1);
    });
  });

  describe('Idempotency-Key — race thật (Week7.md 1.11 (4))', () => {
    it('2 request đồng thời cùng key ⇒ đúng 1 CheckoutGroup tạo ra, cả 2 nhận CÙNG kết quả, không deadlock', async () => {
      const { user, address, variant, expectedTotal } =
        await setupSingleShopCart(2, 10);
      const key = `key-${Date.now().toString(36)}`;
      const input: PlaceOrderInput = {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal,
      };

      const [a, b] = await Promise.all([
        place(user.id, input, key),
        place(user.id, input, key),
      ]);

      expect(a.checkoutGroupId).toBe(b.checkoutGroupId);
      expect(
        await prisma.checkoutGroup.count({ where: { userId: user.id } }),
      ).toBe(1);
      expect(await prisma.order.count({ where: { userId: user.id } })).toBe(1);
      // Giữ chỗ đúng 1 LẦN — không phải 2 lần cộng dồn (2 × 2 = 4 sẽ là lỗi race thật).
      expect(await stockOf(variant.id)).toEqual({
        stock: 10,
        reservedStock: 2,
      });
    });

    it('phát lại đúng key SAU KHI đã thành công — trả lại cùng nhóm, không giữ chỗ thêm', async () => {
      const { user, address, variant, expectedTotal } =
        await setupSingleShopCart(1, 10);
      const key = `key-${Date.now().toString(36)}-replay`;
      const input: PlaceOrderInput = {
        addressId: address.id,
        paymentMethod: 'VNPAY',
        expectedTotal,
      };

      const first = await place(user.id, input, key);
      const second = await place(user.id, input, key);

      expect(second.checkoutGroupId).toBe(first.checkoutGroupId);
      expect(await stockOf(variant.id)).toEqual({
        stock: 10,
        reservedStock: 1,
      });
    });
  });

  // Week7.md 2.13: khác race Idempotency-Key ở trên (CÙNG user, cùng key) — đây là N NGƯỜI MUA
  // KHÁC NHAU cùng tranh 1 variant qua ĐÚNG luồng placeOrder đầy đủ (không gọi thẳng
  // InventoryService.reserve() như inventory.service.int-spec.ts), chứng minh cả transaction
  // (xoá giỏ + giữ chỗ + tạo đơn) không oversell khi chạy thật trên Postgres.
  describe('race thật — N người mua khác nhau tranh 1 variant còn ít hàng (Week7.md 2.13)', () => {
    it('8 người đặt đồng thời, variant chỉ còn 5 — đúng 5 đơn thành công, 3 còn lại 409 OUT_OF_STOCK, reservedStock = 5 (available = 0)', async () => {
      const STOCK = 5;
      const CONCURRENT = 8;
      const base = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, base, {
        stock: STOCK,
        price: 100_000,
      });
      const expectedTotal = 100_000 * 1 + shippingFeeFor(500, 1);

      const buyers = await Promise.all(
        Array.from({ length: CONCURRENT }, async () => {
          const user = await createUser(prisma, TAG);
          const address = await createAddress(prisma, user.id);
          await addCartItem(prisma, user.id, variant.id, 1);
          return { user, address };
        }),
      );

      const results = await Promise.allSettled(
        buyers.map(({ user, address }) =>
          place(user.id, {
            addressId: address.id,
            paymentMethod: 'VNPAY',
            expectedTotal,
          }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(succeeded).toHaveLength(STOCK);
      expect(rejected).toHaveLength(CONCURRENT - STOCK);
      expect(
        rejected.every(
          (r) => (r.reason as { code?: string }).code === 'OUT_OF_STOCK',
        ),
      ).toBe(true);

      // available = stock - reservedStock = 0; không bao giờ reservedStock > stock (CHECK ở DB
      // là lưới cuối, đã kiểm riêng ở inventory.service.int-spec.ts).
      expect(await stockOf(variant.id)).toEqual({
        stock: STOCK,
        reservedStock: STOCK,
      });
      expect(await prisma.order.count({ where: { shopId: base.shopId } })).toBe(
        STOCK,
      );

      // Người mua KHÔNG thành công vẫn còn nguyên dòng giỏ (transaction rollback không để lại gì
      // dở dang) — không phân biệt được ai thắng/thua trước khi chạy nên kiểm tổng dòng giỏ còn
      // lại đúng bằng số người thua.
      const remainingCartLines = await prisma.cartItem.count({
        where: { cart: { userId: { in: buyers.map((b) => b.user.id) } } },
      });
      expect(remainingCartLines).toBe(CONCURRENT - STOCK);
    });
  });
});
