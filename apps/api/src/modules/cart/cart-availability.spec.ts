import {
  isOwnShopVariant,
  isVariantAvailable,
  type VariantAvailabilityRow,
} from './cart-availability';

function row(
  isActive: boolean,
  productStatus: string,
  shopStatus: string,
): VariantAvailabilityRow {
  return {
    stock: 5,
    reservedStock: 0,
    isActive,
    product: { status: productStatus },
    shop: { status: shopStatus, ownerId: 'owner-1' },
  } as VariantAvailabilityRow;
}

const PRODUCT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const SHOP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

// Week6.md 1.9: chỉ bán được khi variant bật + product PUBLISHED + shop
// APPROVED. Duyệt đủ mọi tổ hợp (2 × 3 × 4) để không sót nhánh nào.
describe('isVariantAvailable', () => {
  const combos = [true, false].flatMap((isActive) =>
    PRODUCT_STATUSES.flatMap((productStatus) =>
      SHOP_STATUSES.map((shopStatus) => ({
        isActive,
        productStatus,
        shopStatus,
        expected:
          isActive &&
          productStatus === 'PUBLISHED' &&
          shopStatus === 'APPROVED',
      })),
    ),
  );

  it.each(combos)(
    'isActive=$isActive, product=$productStatus, shop=$shopStatus → $expected',
    ({ isActive, productStatus, shopStatus, expected }) => {
      expect(isVariantAvailable(row(isActive, productStatus, shopStatus))).toBe(
        expected,
      );
    },
  );

  it('chỉ đúng 1 trong 24 tổ hợp là khả dụng', () => {
    expect(combos.filter((c) => c.expected)).toHaveLength(1);
  });
});

// Người bán không được mua sản phẩm của chính shop mình (Week9.md 2.10). Luật phụ thuộc NGƯỜI XEM nên không nằm
// trong isVariantAvailable (một sản phẩm đang bán bình thường với mọi người khác).
describe('isOwnShopVariant', () => {
  const variant = row(true, 'PUBLISHED', 'APPROVED'); // shop do 'owner-1' làm chủ

  it('đúng chủ shop ⇒ true', () => {
    expect(isOwnShopVariant(variant, 'owner-1')).toBe(true);
  });

  it('người khác ⇒ false', () => {
    expect(isOwnShopVariant(variant, 'user-2')).toBe(false);
  });

  it('không biết người xem (guest) ⇒ false, không bao giờ khớp nhầm với chủ shop', () => {
    expect(isOwnShopVariant(variant, undefined)).toBe(false);
  });

  it.each(['PENDING', 'REJECTED', 'SUSPENDED'])(
    'không phụ thuộc trạng thái shop (%s) — chủ shop vẫn là chủ shop',
    (shopStatus) => {
      expect(
        isOwnShopVariant(row(true, 'PUBLISHED', shopStatus), 'owner-1'),
      ).toBe(true);
    },
  );
});
