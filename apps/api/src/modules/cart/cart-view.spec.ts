import { Prisma } from '@prisma/client';
import {
  applyDiscount,
  composeCartView,
  type CartLineSource,
  type CartVariantRow,
} from './cart-view';

function variant(overrides: Record<string, unknown> = {}): CartVariantRow {
  return {
    id: 'v1',
    price: new Prisma.Decimal('100000'),
    stock: 10,
    reservedStock: 0,
    isActive: true,
    product: {
      id: 'p1',
      name: 'Áo thun',
      slug: 'ao-thun',
      status: 'PUBLISHED',
    },
    shop: {
      id: 's1',
      name: 'Shop A',
      slug: 'shop-a',
      status: 'APPROVED',
      ownerId: 'owner-a',
    },
    images: [{ url: 'https://example.com/a.jpg' }],
    attributeValues: [],
    ...overrides,
  };
}

function line(
  quantity: number,
  v: CartVariantRow,
  id: string | null = 'item-1',
): CartLineSource {
  return { id, productVariantId: v.id, quantity, variant: v };
}

describe('composeCartView', () => {
  // --- Người bán không được tự mua (Week9.md 2.10) -------------------------------------------------------
  describe('dòng thuộc shop của chính người xem', () => {
    const own = () =>
      variant({ id: 'own', price: new Prisma.Decimal('500000') });
    const other = () =>
      variant({
        id: 'other',
        price: new Prisma.Decimal('100000'),
        shop: {
          id: 's2',
          name: 'Shop B',
          slug: 'shop-b',
          status: 'APPROVED',
          ownerId: 'owner-b',
        },
      });

    it('bị loại khỏi mua (isAvailable=false) kèm lý do OWN_SHOP, không cộng vào subtotal / tổng', () => {
      const view = composeCartView(
        [line(2, own(), 'i1'), line(1, other(), 'i2')],
        'owner-a',
      );

      const ownLine = view.shops.find((s) => s.shopId === 's1')?.items[0];
      expect(ownLine).toMatchObject({
        productVariantId: 'own',
        isAvailable: false,
        unavailableReason: 'OWN_SHOP',
      });
      expect(view.shops.find((s) => s.shopId === 's1')?.subtotal).toBe('0');
      expect(view.subtotal).toBe('100000'); // chỉ còn dòng của shop B
      expect(view.grandTotal).toBe('100000');
      // Vẫn hiện trong giỏ và vẫn được đếm là một dòng (người dùng còn xoá được).
      expect(view.itemCount).toBe(2);
    });

    it('dòng của shop KHÁC không bị ảnh hưởng và không có lý do', () => {
      const view = composeCartView([line(1, other())], 'owner-a');

      const item = view.shops[0].items[0];
      expect(item.isAvailable).toBe(true);
      expect(item).not.toHaveProperty('unavailableReason');
    });

    it('không biết người xem (guest) ⇒ không áp luật: dòng vẫn mua được', () => {
      const view = composeCartView([line(1, own())]);

      expect(view.shops[0].items[0].isAvailable).toBe(true);
      expect(view.shops[0].items[0]).not.toHaveProperty('unavailableReason');
    });

    it('người xem là chủ shop KHÁC ⇒ dòng này không bị loại', () => {
      const view = composeCartView([line(1, own())], 'owner-b');

      expect(view.shops[0].items[0].isAvailable).toBe(true);
    });

    it('sản phẩm đã ngừng bán thì lý do là "không khả dụng" chung (không gắn OWN_SHOP)', () => {
      const delisted = variant({
        product: {
          id: 'p1',
          name: 'Áo thun',
          slug: 'ao-thun',
          status: 'ARCHIVED',
        },
      });

      const item = composeCartView([line(1, delisted)], 'owner-a').shops[0]
        .items[0];

      expect(item.isAvailable).toBe(false);
      expect(item).not.toHaveProperty('unavailableReason');
    });

    it('KHÔNG lộ ownerId (định danh chủ shop) ra response', () => {
      const view = composeCartView([line(1, own())], 'owner-a');

      expect(JSON.stringify(view)).not.toContain('owner-a');
    });
  });

  it('field stock trả về là available (stock - reservedStock)', () => {
    const v1 = variant({ stock: 10, reservedStock: 4 });

    const view = composeCartView([line(1, v1)]);

    expect(view.shops[0].items[0].stock).toBe(6);
  });

  it('giỏ rỗng — mọi tổng bằng 0, không có shop', () => {
    expect(composeCartView([])).toEqual({
      shops: [],
      subtotal: '0',
      discount: null,
      grandTotal: '0',
      itemCount: 0,
    });
  });

  it('nhóm theo shop, tính đúng subtotal từng shop và tổng giỏ', () => {
    const a1 = variant({ id: 'a1', price: new Prisma.Decimal('100000') });
    const a2 = variant({ id: 'a2', price: new Prisma.Decimal('50000') });
    const b1 = variant({
      id: 'b1',
      price: new Prisma.Decimal('200000'),
      shop: { id: 's2', name: 'Shop B', slug: 'shop-b', status: 'APPROVED' },
    });

    const view = composeCartView([line(2, a1), line(1, b1), line(3, a2)]);

    expect(view.shops.map((s) => s.shopId)).toEqual(['s1', 's2']);
    expect(view.shops[0].items.map((i) => i.productVariantId)).toEqual([
      'a1',
      'a2',
    ]);
    expect(view.shops[0].subtotal).toBe('350000'); // 2×100k + 3×50k
    expect(view.shops[1].subtotal).toBe('200000');
    expect(view.subtotal).toBe('550000');
    expect(view.grandTotal).toBe('550000');
    expect(view.itemCount).toBe(3); // 3 dòng (a1, a2, b1), không phải tổng số lượng 6
  });

  // Regression: badge giỏ hàng từng cộng số lượng nên giỏ 1 sản phẩm x16 hiện
  // 16 — sai với thực tế các sàn (đếm số sản phẩm khác nhau).
  it('itemCount đếm số dòng, không cộng số lượng: 1 sản phẩm x16 -> 1', () => {
    const view = composeCartView([line(16, variant())]);

    expect(view.itemCount).toBe(1);
  });

  it('tính lineTotal = giá × số lượng và lấy giá live theo variant', () => {
    const v = variant({ price: new Prisma.Decimal('149000') });

    const [item] = composeCartView([line(3, v)]).shops[0].items;

    expect(item.unitPrice).toBe('149000');
    expect(item.lineTotal).toBe('447000');
  });

  it.each([
    ['variant bị tắt', { isActive: false }],
    [
      'product không PUBLISHED',
      { product: { id: 'p1', name: 'x', slug: 'x', status: 'ARCHIVED' } },
    ],
    [
      'shop chưa APPROVED',
      { shop: { id: 's1', name: 'x', slug: 'x', status: 'SUSPENDED' } },
    ],
  ])('%s — isAvailable=false và bị loại khỏi tổng tiền', (_label, override) => {
    const ok = variant({ id: 'ok', price: new Prisma.Decimal('100000') });
    const bad = variant({
      id: 'bad',
      price: new Prisma.Decimal('999000'),
      ...override,
    });

    const view = composeCartView([line(1, ok), line(1, bad)]);
    const items = view.shops[0].items;

    expect(items.find((i) => i.productVariantId === 'bad')?.isAvailable).toBe(
      false,
    );
    expect(items.find((i) => i.productVariantId === 'ok')?.isAvailable).toBe(
      true,
    );
    expect(view.shops[0].subtotal).toBe('100000');
    expect(view.subtotal).toBe('100000');
    expect(view.itemCount).toBe(2);
  });

  it('shop chỉ có item không khả dụng — vẫn hiện nhóm với subtotal 0', () => {
    const bad = variant({ isActive: false });

    const view = composeCartView([line(2, bad)]);

    expect(view.shops).toHaveLength(1);
    expect(view.shops[0].subtotal).toBe('0');
    expect(view.grandTotal).toBe('0');
  });

  it('giữ id của CartItem (user) và null cho guest', () => {
    const v = variant();

    expect(composeCartView([line(1, v, 'item-9')]).shops[0].items[0].id).toBe(
      'item-9',
    );
    expect(composeCartView([line(1, v, null)]).shops[0].items[0].id).toBeNull();
  });

  it('lấy ảnh đầu tiên, null nếu variant chưa có ảnh', () => {
    const withImage = composeCartView([line(1, variant())]);
    const noImage = composeCartView([line(1, variant({ images: [] }))]);

    expect(withImage.shops[0].items[0].imageUrl).toBe(
      'https://example.com/a.jpg',
    );
    expect(noImage.shops[0].items[0].imageUrl).toBeNull();
  });

  it('sắp xếp thuộc tính theo position của attribute', () => {
    const v = variant({
      attributeValues: [
        {
          attributeValue: {
            value: 'M',
            attribute: { name: 'Size', position: 1 },
          },
        },
        {
          attributeValue: {
            value: 'Đỏ',
            attribute: { name: 'Màu', position: 0 },
          },
        },
      ],
    });

    expect(composeCartView([line(1, v)]).shops[0].items[0].attributes).toEqual([
      { name: 'Màu', value: 'Đỏ' },
      { name: 'Size', value: 'M' },
    ]);
  });
});

describe('applyDiscount', () => {
  const discount = { code: 'SALE10', shopId: null, amount: '30000' };

  it('gắn discount và trừ vào grandTotal, subtotal giữ nguyên', () => {
    const base = composeCartView([line(3, variant())]); // 300.000

    const result = applyDiscount(base, discount);

    expect(result.discount).toEqual(discount);
    expect(result.subtotal).toBe('300000');
    expect(result.grandTotal).toBe('270000');
  });

  it('không sửa đổi view gốc (hàm thuần)', () => {
    const base = composeCartView([line(1, variant())]);

    applyDiscount(base, discount);

    expect(base.discount).toBeNull();
    expect(base.grandTotal).toBe('100000');
  });

  it('giảm đúng bằng subtotal thì grandTotal là 0, không âm', () => {
    const base = composeCartView([line(1, variant())]); // 100.000

    const result = applyDiscount(base, { ...discount, amount: '100000' });

    expect(result.grandTotal).toBe('0');
  });
});
