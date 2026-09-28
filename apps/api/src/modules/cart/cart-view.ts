import { type Prisma } from '@prisma/client';
import type {
  CartDiscount,
  CartLine,
  CartShopGroup,
  CartView,
} from '@ecommerce/types';
import { availableStock } from '../../shared/utils/available-stock';
import { isVariantAvailable } from './cart-availability';

// Mọi thứ cần để dựng 1 dòng giỏ hiển thị được: giá live, tồn kho, tên
// product/shop, ảnh đầu tiên của variant, thuộc tính đã chọn (Week6.md 1.2).
export const cartVariantSelect = {
  id: true,
  price: true,
  stock: true,
  reservedStock: true,
  isActive: true,
  product: {
    select: { id: true, name: true, slug: true, status: true },
  },
  shop: {
    select: { id: true, name: true, slug: true, status: true },
  },
  images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
  attributeValues: {
    select: {
      attributeValue: {
        select: {
          value: true,
          attribute: { select: { name: true, position: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

export type CartVariantRow = Prisma.ProductVariantGetPayload<{
  select: typeof cartVariantSelect;
}>;

// 1 dòng giỏ đã ghép với variant tương ứng. id chỉ có với giỏ trong DB.
export interface CartLineSource {
  id: string | null;
  productVariantId: string;
  quantity: number;
  variant: CartVariantRow;
}

// Hàm thuần dùng chung cho GET /cart (đăng nhập) và POST /cart/quote (guest)
// — Week6.md 1.7: nhóm theo shop, tính subtotal, đánh dấu isAvailable. Tiền
// tính bằng số nguyên đồng (VND không có phần lẻ), xuất ra chuỗi. itemCount đếm
// số DÒNG (sản phẩm khác nhau) chứ không cộng số lượng — giống badge giỏ hàng
// của các sàn (giỏ 1 sản phẩm x16 hiện 1, không phải 16). Item không
// khả dụng (1.9) vẫn hiện nhưng KHÔNG cộng vào subtotal/tổng.
export function composeCartView(lines: CartLineSource[]): CartView {
  const groups = new Map<string, CartShopGroup & { subtotalValue: number }>();
  let subtotal = 0;
  let itemCount = 0;

  for (const source of lines) {
    const { variant } = source;
    const unitPrice = variant.price.toNumber();
    const lineTotal = unitPrice * source.quantity;
    const isAvailable = isVariantAvailable(variant);

    const line: CartLine = {
      id: source.id,
      productVariantId: source.productVariantId,
      quantity: source.quantity,
      productId: variant.product.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      imageUrl: variant.images[0]?.url ?? null,
      attributes: [...variant.attributeValues]
        .sort(
          (a, b) =>
            a.attributeValue.attribute.position -
            b.attributeValue.attribute.position,
        )
        .map(({ attributeValue }) => ({
          name: attributeValue.attribute.name,
          value: attributeValue.value,
        })),
      unitPrice: String(unitPrice),
      lineTotal: String(lineTotal),
      stock: availableStock(variant),
      isAvailable,
    };

    let group = groups.get(variant.shop.id);
    if (!group) {
      group = {
        shopId: variant.shop.id,
        shopName: variant.shop.name,
        shopSlug: variant.shop.slug,
        items: [],
        subtotal: '0',
        subtotalValue: 0,
      };
      groups.set(variant.shop.id, group);
    }
    group.items.push(line);
    itemCount += 1;
    if (isAvailable) {
      group.subtotalValue += lineTotal;
      subtotal += lineTotal;
    }
  }

  const shops = [...groups.values()].map(
    ({ subtotalValue, ...group }): CartShopGroup => ({
      ...group,
      subtotal: String(subtotalValue),
    }),
  );

  return {
    shops,
    subtotal: String(subtotal),
    discount: null,
    grandTotal: String(subtotal),
    itemCount,
  };
}

// Áp discount đã validate lên view chưa giảm giá. Số tiền giảm luôn ≤ cơ sở
// tính (calculateDiscount đã cap) nên grandTotal không âm.
export function applyDiscount(
  view: CartView,
  discount: CartDiscount,
): CartView {
  return {
    ...view,
    discount,
    grandTotal: String(Number(view.subtotal) - Number(discount.amount)),
  };
}
