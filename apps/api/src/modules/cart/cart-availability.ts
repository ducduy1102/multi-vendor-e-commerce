import { ProductStatus, ShopStatus, type Prisma } from '@prisma/client';

// Dùng chung cho CartService (chặn thêm variant không khả dụng) và
// buildCartView (đánh dấu isAvailable) — Week6.md Bước 1.9: variant còn bán
// khi variant/product/shop đều đang hoạt động.
export const variantAvailabilitySelect = {
  stock: true,
  reservedStock: true,
  isActive: true,
  product: { select: { status: true } },
  shop: { select: { status: true } },
} satisfies Prisma.ProductVariantSelect;

export type VariantAvailabilityRow = Prisma.ProductVariantGetPayload<{
  select: typeof variantAvailabilitySelect;
}>;

export function isVariantAvailable(variant: VariantAvailabilityRow): boolean {
  return (
    variant.isActive &&
    variant.product.status === ProductStatus.PUBLISHED &&
    variant.shop.status === ShopStatus.APPROVED
  );
}
