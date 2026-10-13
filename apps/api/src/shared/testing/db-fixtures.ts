import type { OrderActorType, OrderStatus, PrismaClient } from '@prisma/client';

// Dữ liệu dựng cho các integration test (`*.int-spec.ts`, chạy bằng `pnpm test:int`) trên DB dev
// thật. Mọi bản ghi mang tiền tố `tag` riêng của từng file spec và được dọn theo tiền tố đó, để
// không đụng dữ liệu seed/test tay và 2 spec không dẫm lên nhau.

let counter = 0;
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createUser(prisma: PrismaClient, tag: string) {
  return prisma.user.create({
    data: {
      email: `${tag}${nextId()}@test.local`,
      name: `${tag}user`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
}

export async function createShopWithProduct(prisma: PrismaClient, tag: string) {
  const owner = await createUser(prisma, tag);
  const category = await prisma.category.create({
    data: { name: `${tag}cat`, slug: `${tag}cat-${nextId()}` },
    select: { id: true },
  });
  const shop = await prisma.shop.create({
    data: {
      ownerId: owner.id,
      name: `${tag}shop`,
      slug: `${tag}shop-${nextId()}`,
      status: 'APPROVED',
    },
    select: { id: true },
  });
  const product = await prisma.product.create({
    data: {
      shopId: shop.id,
      categoryId: category.id,
      name: `${tag}product`,
      slug: `${tag}product-${nextId()}`,
      status: 'PUBLISHED',
      minPrice: 100000,
      maxPrice: 100000,
    },
    select: { id: true },
  });
  return { shopId: shop.id, productId: product.id };
}

export async function createVariant(
  prisma: PrismaClient,
  base: { shopId: string; productId: string },
  overrides: { stock: number; reservedStock?: number; price?: number },
) {
  return prisma.productVariant.create({
    data: {
      productId: base.productId,
      shopId: base.shopId,
      sku: `SKU-${nextId()}`,
      price: overrides.price ?? 100000,
      stock: overrides.stock,
      reservedStock: overrides.reservedStock ?? 0,
    },
    select: { id: true },
  });
}

// Lịch sử trạng thái THỰC TẾ cho 1 đơn seed ở `status` (cũ → mới, đúng đường đi mà luồng thật tạo ra):
//  - đơn COD tạo thẳng ở PENDING (đã đặt, chưa thu tiền); hủy ở PENDING do người mua;
//  - đơn online tạo ở AWAITING_PAYMENT, thanh toán xong → PENDING; đơn online CANCELLED là đơn CHƯA TỪNG
//    được thanh toán (hết hạn / người mua hủy nhóm) nên không có bước PENDING — chính là điều Seller
//    không được thấy (sellerVisibleOrderFilter).
// Dùng thay cho 1 dòng `null → AWAITING_PAYMENT` cho mọi trạng thái như trước, vì bộ lọc Seller giờ dựa
// vào việc đơn TỪNG ở PENDING.
export function seedOrderHistory(
  status: OrderStatus,
  options: { isCod: boolean },
): Array<{
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: OrderActorType;
  createdAt: Date;
}> {
  const base = Date.parse('2026-10-01T10:00:00.000Z');
  const rows: ReturnType<typeof seedOrderHistory> = [];
  let last: OrderStatus | null = null;
  const step = (toStatus: OrderStatus, actorType: OrderActorType) => {
    rows.push({
      fromStatus: last,
      toStatus,
      actorType,
      createdAt: new Date(base + rows.length * 60_000),
    });
    last = toStatus;
  };

  if (options.isCod && status === 'AWAITING_PAYMENT') {
    throw new Error('Đơn COD không bao giờ ở trạng thái AWAITING_PAYMENT');
  }
  step(options.isCod ? 'PENDING' : 'AWAITING_PAYMENT', 'BUYER');
  if (status === 'AWAITING_PAYMENT') return rows;
  if (status === 'CANCELLED') {
    step('CANCELLED', options.isCod ? 'BUYER' : 'SYSTEM');
    return rows;
  }
  if (!options.isCod) step('PENDING', 'SYSTEM');
  for (const next of [
    'CONFIRMED',
    'PACKED',
    'SHIPPING',
    'COMPLETED',
  ] as const) {
    if (status === 'PENDING') break;
    step(next, next === 'COMPLETED' ? 'BUYER' : 'SELLER');
    if (next === status) break;
  }
  return rows;
}

export async function createCheckoutGroup(
  prisma: PrismaClient,
  userId: string,
) {
  return prisma.checkoutGroup.create({
    data: { userId },
    select: { id: true },
  });
}

// Đơn COD của `userId` gồm đúng 1 dòng hàng `variantId` (đã chốt kho — không đụng tồn kho), mặc định đã
// COMPLETED vào lúc `completedAt` (mặc định: hôm qua). Dùng cho int-spec đánh giá: lịch sử trạng thái đi đúng
// đường thật (PENDING → CONFIRMED → PACKED → SHIPPING → COMPLETED), các mốc lùi dần từ `completedAt` nên mốc
// COMPLETED luôn là dòng mới nhất. COD nên không cần Payment trước khi giao; tạo kèm Payment COD để chi tiết đơn
// hiện phương thức thanh toán như đơn thật.
export async function createOrderWithItem(
  prisma: PrismaClient,
  input: {
    userId: string;
    shopId: string;
    variantId: string;
    status?: OrderStatus;
    completedAt?: Date;
  },
) {
  const status = input.status ?? 'COMPLETED';
  const completedAt =
    input.completedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const history = seedOrderHistory(status, { isCod: true });
  const group = await createCheckoutGroup(prisma, input.userId);
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: input.variantId },
    select: { sku: true, price: true },
  });

  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      shopId: input.shopId,
      checkoutGroupId: group.id,
      status,
      totalAmount: variant.price,
      recipientName: 'Nguyễn Văn A',
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      shippingProvince: 'Hồ Chí Minh',
      items: {
        create: [
          {
            productVariantId: input.variantId,
            quantity: 1,
            priceAtPurchase: variant.price,
            productName: `${nextId()}-sp`,
            sku: variant.sku,
            variantLabel: null,
            imageUrl: null,
          },
        ],
      },
      statusHistory: {
        create: history.map((row, index) => ({
          ...row,
          createdAt: new Date(
            completedAt.getTime() - (history.length - 1 - index) * 60_000,
          ),
        })),
      },
    },
    select: { id: true },
  });
  await prisma.payment.create({
    data: {
      checkoutGroupId: group.id,
      method: 'COD',
      status: status === 'COMPLETED' ? 'SUCCESS' : 'PENDING',
      amount: variant.price,
      txnRef: `ORDER${nextId()}`.toUpperCase(),
      expiresAt: null,
      paidAt: status === 'COMPLETED' ? completedAt : null,
    },
  });
  return { orderId: order.id, groupId: group.id };
}

// Sổ địa chỉ giao hàng — dùng trực tiếp prisma (không qua AddressService) vì int-spec chỉ cần dữ
// liệu hợp lệ, không kiểm lại luật CRUD (đã có address.int-spec.ts riêng).
export async function createAddress(
  prisma: PrismaClient,
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.address.create({
    data: {
      userId,
      recipientName: 'Nguyễn Văn A',
      phone: '0912345678',
      line1: '12 Nguyễn Huệ',
      ward: 'Phường Bến Nghé',
      province: 'Hồ Chí Minh',
      isDefault: true,
      ...overrides,
    },
    select: { id: true },
  });
}

export async function addCartItem(
  prisma: PrismaClient,
  userId: string,
  productVariantId: string,
  quantity: number,
) {
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
  return prisma.cartItem.create({
    data: { cartId: cart.id, productVariantId, quantity },
    select: { id: true },
  });
}

export async function cleanupByTag(prisma: PrismaClient, tag: string) {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  // Thứ tự xoá theo chiều FK RESTRICT (Payment/Order/VoucherUsage → CheckoutGroup → User;
  // Order/OrderItem → Shop/ProductVariant): xoá "lá" trước "gốc". Cart/CartItem/Address cascade
  // tự động theo User (onDelete: Cascade) nên không cần dọn riêng.
  // Tuần 9 thêm 3 bảng giữ FK RESTRICT/không cascade tới Order/Payment/Shop/User nên phải xoá TRƯỚC:
  // PaymentRefund trước RefundRequest (nó tham chiếu RefundRequest), RefundRequestHistory tự xoá theo
  // RefundRequest (cascade); Review trước Order (Review.order không cascade).
  await prisma.paymentRefund.deleteMany({
    where: { payment: { checkoutGroup: { userId: { in: userIds } } } },
  });
  await prisma.refundRequest.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { shop: { slug: { startsWith: tag } } },
      ],
    },
  });
  await prisma.review.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { product: { shop: { slug: { startsWith: tag } } } },
      ],
    },
  });
  await prisma.payment.deleteMany({
    where: { checkoutGroup: { userId: { in: userIds } } },
  });
  await prisma.voucherUsage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }); // cascade OrderItem
  await prisma.checkoutGroup.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.voucher.deleteMany({
    where: { code: { startsWith: tag.toUpperCase() } },
  });
  // Xoá shop kéo theo product/variant (onDelete: Cascade).
  await prisma.shop.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
