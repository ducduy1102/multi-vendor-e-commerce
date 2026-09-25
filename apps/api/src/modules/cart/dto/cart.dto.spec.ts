import {
  addCartItemSchema,
  cartItemsBodySchema,
  cartQuerySchema,
  cartQuoteBodySchema,
  updateCartItemSchema,
} from './cart.dto';

const item = { productVariantId: 'variant-1', quantity: 2 };

describe('cart DTO schemas', () => {
  describe('addCartItemSchema', () => {
    it('payload hợp lệ', () => {
      expect(addCartItemSchema.safeParse(item).success).toBe(true);
    });

    it.each([
      ['thiếu productVariantId', { quantity: 1 }],
      ['productVariantId rỗng', { productVariantId: '', quantity: 1 }],
      ['quantity bằng 0', { ...item, quantity: 0 }],
      ['quantity âm', { ...item, quantity: -1 }],
      ['quantity không nguyên', { ...item, quantity: 1.5 }],
      ['quantity là chuỗi', { ...item, quantity: '2' }],
    ])('%s bị từ chối', (_label, payload) => {
      expect(addCartItemSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe('updateCartItemSchema', () => {
    it('quantity ≥ 1 hợp lệ, 0 bị từ chối (xoá phải dùng DELETE)', () => {
      expect(updateCartItemSchema.safeParse({ quantity: 1 }).success).toBe(
        true,
      );
      expect(updateCartItemSchema.safeParse({ quantity: 0 }).success).toBe(
        false,
      );
    });
  });

  describe('cartItemsBodySchema (merge)', () => {
    it('mảng rỗng hợp lệ', () => {
      expect(cartItemsBodySchema.safeParse({ items: [] }).success).toBe(true);
    });

    it('quá 100 dòng bị từ chối', () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        productVariantId: `v${i}`,
        quantity: 1,
      }));

      expect(cartItemsBodySchema.safeParse({ items }).success).toBe(false);
    });

    it('có dòng sai thì cả body bị từ chối', () => {
      expect(
        cartItemsBodySchema.safeParse({
          items: [item, { productVariantId: 'v2', quantity: 0 }],
        }).success,
      ).toBe(false);
    });
  });

  describe('cartQuoteBodySchema', () => {
    it('không có voucherCode hợp lệ', () => {
      expect(cartQuoteBodySchema.safeParse({ items: [item] }).success).toBe(
        true,
      );
    });

    it('voucherCode được trim; chuỗi rỗng vẫn hợp lệ (coi như không có mã)', () => {
      const trimmed = cartQuoteBodySchema.parse({
        items: [item],
        voucherCode: '  SALE10 ',
      });
      const empty = cartQuoteBodySchema.safeParse({
        items: [item],
        voucherCode: '',
      });

      expect(trimmed.voucherCode).toBe('SALE10');
      expect(empty.success).toBe(true);
    });

    it('voucherCode quá 32 ký tự bị từ chối', () => {
      expect(
        cartQuoteBodySchema.safeParse({
          items: [item],
          voucherCode: 'A'.repeat(33),
        }).success,
      ).toBe(false);
    });
  });

  describe('cartQuerySchema', () => {
    it('không có query hợp lệ', () => {
      expect(cartQuerySchema.safeParse({}).success).toBe(true);
    });

    it('nhận voucherCode dạng chuỗi', () => {
      expect(cartQuerySchema.parse({ voucherCode: 'SALE10' })).toEqual({
        voucherCode: 'SALE10',
      });
    });
  });
});
