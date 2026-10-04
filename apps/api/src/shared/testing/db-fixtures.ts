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
