import type { PrismaClient } from '@prisma/client';

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

export async function createCheckoutGroup(
  prisma: PrismaClient,
  userId: string,
) {
  return prisma.checkoutGroup.create({
    data: { userId },
    select: { id: true },
  });
}

export async function cleanupByTag(prisma: PrismaClient, tag: string) {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.voucherUsage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.voucher.deleteMany({
    where: { code: { startsWith: tag.toUpperCase() } },
  });
  // Xoá shop kéo theo product/variant (onDelete: Cascade).
  await prisma.shop.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
