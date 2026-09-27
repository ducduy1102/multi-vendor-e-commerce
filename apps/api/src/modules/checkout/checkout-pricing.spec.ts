import {
  allocateDiscount,
  buildCheckoutPlan,
  type AllocationBasis,
  type CheckoutPlanInput,
  type CheckoutPlanItem,
} from './checkout-pricing';
import type { ShippingRates } from './shipping-rates';

// Bảng giá cố định, dễ tính tay, dùng cho mọi test buildCheckoutPlan bên dưới.
const FLAT_RATES: ShippingRates = {
  INTRA_PROVINCE: { baseFee: 20_000, feePerTier: 0 },
  INTRA_REGION: { baseFee: 20_000, feePerTier: 0 },
  INTER_REGION: { baseFee: 20_000, feePerTier: 0 },
};

const item = (overrides: Partial<CheckoutPlanItem> = {}): CheckoutPlanItem => ({
  cartItemId: 'ci-1',
  productVariantId: 'v-1',
  productName: 'Áo thun',
  variantLabel: 'Đỏ / M',
  sku: 'SKU-1',
  imageUrl: null,
  quantity: 1,
  unitPrice: 100_000,
  weightGram: 500,
  ...overrides,
});

// Seeded PRNG (mulberry32) — không thêm thư viện property-testing (Week7.md 1.6).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tham chiếu ĐỘC LẬP: chia bằng BigInt viết lại từ đầu, không tái dùng bất kỳ dòng nào của allocateDiscount.
function referenceAllocate(
  orders: AllocationBasis[],
  totalDiscount: number,
): Map<string, number> {
  const base = orders.reduce((s, o) => s + o.subtotal, 0);
  if (base <= 0 || totalDiscount <= 0) {
    return new Map(orders.map((o) => [o.shopId, 0]));
  }
  const capped = Math.min(totalDiscount, base);
  const baseBig = BigInt(base);
  const entries = orders.map((o) => {
    const num = BigInt(capped) * BigInt(o.subtotal);
    return {
      shopId: o.shopId,
      floor: Number(num / baseBig),
      rem: num % baseBig,
    };
  });
  const left = capped - entries.reduce((s, e) => s + e.floor, 0);
  const order = [...entries].sort((a, b) =>
    a.rem !== b.rem
      ? a.rem > b.rem
        ? -1
        : 1
      : a.shopId < b.shopId
        ? -1
        : a.shopId > b.shopId
          ? 1
          : 0,
  );
  const result = new Map(entries.map((e) => [e.shopId, e.floor]));
  for (let i = 0; i < left; i++) {
    result.set(order[i].shopId, (result.get(order[i].shopId) ?? 0) + 1);
  }
  return result;
}

describe('allocateDiscount', () => {
  it('1 đơn ⇒ nhận đủ', () => {
    const result = allocateDiscount(
      [{ shopId: 'a', subtotal: 300_000 }],
      30_000,
    );
    expect(result.get('a')).toBe(30_000);
  });

  it('tổng giảm 0 ⇒ mọi phần 0', () => {
    const result = allocateDiscount(
      [
        { shopId: 'a', subtotal: 100 },
        { shopId: 'b', subtotal: 200 },
      ],
      0,
    );
    expect([...result.values()]).toEqual([0, 0]);
  });

  it('tổng giảm = cơ sở ⇒ mỗi phần = subtotal đơn đó', () => {
    const orders = [
      { shopId: 'a', subtotal: 300_000 },
      { shopId: 'b', subtotal: 700_000 },
    ];
    const result = allocateDiscount(orders, 1_000_000);
    expect(result.get('a')).toBe(300_000);
    expect(result.get('b')).toBe(700_000);
  });

  it('không có đơn nào ⇒ map rỗng, không lỗi', () => {
    expect(allocateDiscount([], 1000)).toEqual(new Map());
  });

  it('chia không chẵn: 100 chia 3 đơn bằng nhau → tổng vẫn đúng 100, lệch tối đa 1 đồng/đơn', () => {
    const orders = [
      { shopId: 'a', subtotal: 100 },
      { shopId: 'b', subtotal: 100 },
      { shopId: 'c', subtotal: 100 },
    ];
    const result = allocateDiscount(orders, 100);
    const values = [...result.values()];
    expect(values.reduce((s, v) => s + v, 0)).toBe(100);
    for (const v of values) {
      expect(Math.abs(v - 100 / 3)).toBeLessThan(1);
    }
  });

  it('hoà remainder — ưu tiên shopId nhỏ hơn, KHÔNG phụ thuộc thứ tự mảng đầu vào', () => {
    // 3 đơn subtotal bằng nhau, tổng giảm không chia hết cho 3 -> remainder bằng nhau hết -> tie-break theo shopId.
    const orders = [
      { shopId: 'shop-c', subtotal: 100 },
      { shopId: 'shop-a', subtotal: 100 },
      { shopId: 'shop-b', subtotal: 100 },
    ];
    // floor(101*100/300) = 33 mỗi đơn (99 tổng), dư 2 đồng -> 2 shopId nhỏ nhất được +1 (a, b).
    const result = allocateDiscount(orders, 101);
    expect(result.get('shop-a')).toBe(34);
    expect(result.get('shop-b')).toBe(34);
    expect(result.get('shop-c')).toBe(33);

    // Đảo thứ tự mảng đầu vào -> kết quả (theo shopId) phải giống hệt.
    const reversed = allocateDiscount([...orders].reverse(), 101);
    expect(reversed).toEqual(result);
  });

  it('kết quả không đổi khi hoán vị thứ tự đơn (nhiều đơn, tổng giảm bất kỳ)', () => {
    const orders = [
      { shopId: 'z', subtotal: 137_777 },
      { shopId: 'm', subtotal: 251_003 },
      { shopId: 'a', subtotal: 89_990 },
      { shopId: 'k', subtotal: 400_001 },
    ];
    const base = allocateDiscount(orders, 123_456);
    const shuffled = [orders[2], orders[0], orders[3], orders[1]];
    expect(allocateDiscount(shuffled, 123_456)).toEqual(base);
  });

  it('số lớn (10^8 × 10^8 cỡ) không tràn Number.MAX_SAFE_INTEGER — khớp tham chiếu BigInt', () => {
    const orders = [
      { shopId: 'a', subtotal: 3_000_000_000 },
      { shopId: 'b', subtotal: 7_000_000_000 },
    ];
    const totalDiscount = 9_999_999_999;
    const result = allocateDiscount(orders, totalDiscount);
    expect(result).toEqual(referenceAllocate(orders, totalDiscount));
    expect([...result.values()].reduce((s, v) => s + v, 0)).toBe(totalDiscount);
  });

  describe('bất biến — vòng lặp ngẫu nhiên có hạt giống cố định (3.000 ca)', () => {
    const rand = mulberry32(20260927);
    const cases = Array.from({ length: 3000 }, () => {
      const orderCount = 1 + Math.floor(rand() * 6);
      const orders = Array.from({ length: orderCount }, (_, i) => ({
        shopId: `shop-${i}-${Math.floor(rand() * 1000)}`,
        subtotal: Math.floor(rand() * 10_000_000),
      }));
      const base = orders.reduce((s, o) => s + o.subtotal, 0);
      const totalDiscount = Math.floor(rand() * (base + 1));
      return { orders, totalDiscount, base };
    });

    it('Σ phần chia = tổng giảm đúng từng đồng', () => {
      for (const { orders, totalDiscount } of cases) {
        const result = allocateDiscount(orders, totalDiscount);
        const sum = [...result.values()].reduce((s, v) => s + v, 0);
        expect(sum).toBe(
          Math.min(
            totalDiscount,
            orders.reduce((s, o) => s + o.subtotal, 0),
          ),
        );
      }
    });

    it('0 ≤ phần_i ≤ subtotal_i', () => {
      for (const { orders, totalDiscount } of cases) {
        const result = allocateDiscount(orders, totalDiscount);
        for (const o of orders) {
          const part = result.get(o.shopId) ?? 0;
          expect(part).toBeGreaterThanOrEqual(0);
          expect(part).toBeLessThanOrEqual(o.subtotal);
        }
      }
    });

    it('|phần_i − phần_chính_xác_i| < 1', () => {
      for (const { orders, totalDiscount, base } of cases) {
        if (base <= 0) continue;
        const result = allocateDiscount(orders, totalDiscount);
        for (const o of orders) {
          const exact = (Math.min(totalDiscount, base) * o.subtotal) / base;
          expect(Math.abs((result.get(o.shopId) ?? 0) - exact)).toBeLessThan(1);
        }
      }
    });

    it('khớp tham chiếu BigInt độc lập', () => {
      for (const { orders, totalDiscount } of cases) {
        expect(allocateDiscount(orders, totalDiscount)).toEqual(
          referenceAllocate(orders, totalDiscount),
        );
      }
    });
  });
});

describe('buildCheckoutPlan', () => {
  const HCM = 'Hồ Chí Minh';

  it('1 shop, không voucher: subtotal/shippingFee/totalAmount tính đúng', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'Shop A',
          shopSlug: 'shop-a',
          originProvince: HCM,
          items: [item({ quantity: 2, unitPrice: 150_000 })],
        },
      ],
      destinationProvince: HCM,
      voucher: null,
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({
      subtotal: 300_000,
      shippingFee: 20_000,
      discountAmount: 0,
      totalAmount: 320_000,
    });
    expect(plan.subtotal).toBe(300_000);
    expect(plan.shippingTotal).toBe(20_000);
    expect(plan.discountTotal).toBe(0);
    expect(plan.grandTotal).toBe(320_000);
  });

  it('nhiều shop: tổng toàn nhóm = tổng từng đơn cộng lại', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 100_000 })],
        },
        {
          shopId: 's2',
          shopName: 'B',
          shopSlug: 'b',
          originProvince: HCM,
          items: [item({ unitPrice: 200_000 })],
        },
      ],
      destinationProvince: HCM,
      voucher: null,
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);

    expect(plan.subtotal).toBe(300_000);
    expect(plan.shippingTotal).toBe(40_000);
    expect(plan.grandTotal).toBe(
      plan.orders.reduce((s, o) => s + o.totalAmount, 0),
    );
  });

  it('voucher THEO SHOP: toàn bộ số giảm vào đúng 1 đơn, đơn khác 0', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 300_000 })],
        },
        {
          shopId: 's2',
          shopName: 'B',
          shopSlug: 'b',
          originProvince: HCM,
          items: [item({ unitPrice: 500_000 })],
        },
      ],
      destinationProvince: HCM,
      voucher: { shopId: 's2', amount: 50_000 },
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);

    expect(plan.orders.find((o) => o.shopId === 's1')?.discountAmount).toBe(0);
    expect(plan.orders.find((o) => o.shopId === 's2')?.discountAmount).toBe(
      50_000,
    );
    expect(plan.discountTotal).toBe(50_000);
  });

  it('voucher shop KHÔNG vượt subtotal của đơn đó (lưới an toàn)', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 10_000 })],
        },
      ],
      destinationProvince: HCM,
      voucher: { shopId: 's1', amount: 999_999 },
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);

    expect(plan.orders[0].discountAmount).toBe(10_000);
    expect(plan.orders[0].totalAmount).toBeGreaterThanOrEqual(0);
  });

  it('voucher chỉ định shop không có trong danh sách đơn — không giảm gì, không lỗi', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 100_000 })],
        },
      ],
      destinationProvince: HCM,
      voucher: { shopId: 'missing-shop', amount: 20_000 },
    };

    expect(() => buildCheckoutPlan(input, FLAT_RATES)).not.toThrow();
    const plan = buildCheckoutPlan(input, FLAT_RATES);
    expect(plan.discountTotal).toBe(0);
  });

  it('voucher TOÀN SÀN: chia theo allocateDiscount, tổng discountAmount = số giảm toàn sàn đến từng đồng', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 300_000 })],
        },
        {
          shopId: 's2',
          shopName: 'B',
          shopSlug: 'b',
          originProvince: HCM,
          items: [item({ unitPrice: 700_001 })],
        },
      ],
      destinationProvince: HCM,
      voucher: { shopId: null, amount: 100_000 },
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);

    expect(plan.discountTotal).toBe(100_000);
    for (const order of plan.orders) {
      expect(order.discountAmount).toBeLessThanOrEqual(order.subtotal);
      expect(order.discountAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it('không có voucher — discountAmount = 0 mọi đơn', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item()],
        },
      ],
      destinationProvince: HCM,
      voucher: null,
    };

    expect(buildCheckoutPlan(input, FLAT_RATES).orders[0].discountAmount).toBe(
      0,
    );
  });

  it('weightGram null trong item — vẫn tính được phí ship (dùng mặc định)', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ weightGram: null })],
        },
      ],
      destinationProvince: HCM,
      voucher: null,
    };

    expect(() => buildCheckoutPlan(input, FLAT_RATES)).not.toThrow();
    expect(buildCheckoutPlan(input, FLAT_RATES).orders[0].shippingFee).toBe(
      20_000,
    );
  });

  it('tổng tiền không bao giờ âm', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item({ unitPrice: 1 })],
        },
      ],
      destinationProvince: HCM,
      voucher: { shopId: 's1', amount: 999_999_999 },
    };

    const plan = buildCheckoutPlan(input, FLAT_RATES);
    expect(plan.grandTotal).toBeGreaterThanOrEqual(0);
    expect(plan.orders[0].totalAmount).toBeGreaterThanOrEqual(0);
  });

  it('không có shop nào (giỏ rỗng sau lọc) — trả kế hoạch rỗng, mọi tổng = 0', () => {
    const plan = buildCheckoutPlan(
      { shops: [], destinationProvince: HCM, voucher: null },
      FLAT_RATES,
    );
    expect(plan).toEqual({
      orders: [],
      subtotal: 0,
      shippingTotal: 0,
      discountTotal: 0,
      grandTotal: 0,
    });
  });

  it('dùng bảng giá mặc định khi không truyền rates', () => {
    const input: CheckoutPlanInput = {
      shops: [
        {
          shopId: 's1',
          shopName: 'A',
          shopSlug: 'a',
          originProvince: HCM,
          items: [item()],
        },
      ],
      destinationProvince: HCM,
      voucher: null,
    };
    expect(() => buildCheckoutPlan(input)).not.toThrow();
  });
});
