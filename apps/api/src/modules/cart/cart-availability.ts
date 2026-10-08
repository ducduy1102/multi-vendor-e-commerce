import { ProductStatus, ShopStatus, type Prisma } from '@prisma/client';

// Dùng chung cho CartService (chặn thêm variant không khả dụng) và
// buildCartView (đánh dấu isAvailable) — Week6.md Bước 1.9: variant còn bán
// khi variant/product/shop đều đang hoạt động. `shop.ownerId` chỉ để so với người đang xem
// (isOwnShopVariant) — KHÔNG bao giờ đưa ra response.
export const variantAvailabilitySelect = {
  stock: true,
  reservedStock: true,
  isActive: true,
  product: { select: { status: true } },
  shop: { select: { status: true, ownerId: true } },
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

// Variant thuộc shop do CHÍNH `userId` làm chủ. Người bán không được mua sản phẩm của shop mình: nếu được thì
// tự mua rồi tự đánh giá là cách rẻ nhất để nâng điểm (Week9.md 2.10, luật chặn bổ sung). Khác
// isVariantAvailable ở chỗ phụ thuộc NGƯỜI XEM, nên tách riêng — một sản phẩm đang bán bình thường với mọi người
// khác. Không biết người xem (guest) ⇒ luôn false.
export function isOwnShopVariant(
  variant: Pick<VariantAvailabilityRow, 'shop'>,
  userId: string | undefined,
): boolean {
  return userId !== undefined && variant.shop.ownerId === userId;
}
