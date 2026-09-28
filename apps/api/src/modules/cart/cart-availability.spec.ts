import {
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
    shop: { status: shopStatus },
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
