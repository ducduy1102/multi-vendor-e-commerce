import {
  calculateShippingFee,
  DEFAULT_SHIPPING_RATES,
  type ShippingRates,
} from './shipping-rates';

// --- allocateDiscount (Week7.md 1.6) -------------------------------------------------------

export interface AllocationBasis {
  shopId: string;
  subtotal: number;
}

// Chia tổng số giảm của voucher TOÀN SÀN cho từng đơn theo tỷ lệ subtotal, bằng phương pháp "phần dư
// lớn nhất" (largest remainder / Hamilton): mỗi đơn nhận floor(tổng_giảm × subtotal_i / cơ_sở), phần
// dư còn lại (luôn < số đơn) cộng thêm 1 đồng lần lượt cho các đơn có phần lẻ (remainder) lớn nhất;
// hoà nhau thì ưu tiên shopId NHỎ HƠN — kết quả xác định, KHÔNG phụ thuộc thứ tự mảng đầu vào (tự sắp
// lại bên trong). Dùng BigInt cho phép nhân/chia nguyên: `tổng_giảm × subtotal_i` vượt
// Number.MAX_SAFE_INTEGER ở đơn hàng cỡ 10^8 × 10^8 (Week7.md 1.6, đã kiểm chứng bằng tính thật).
//
// `cơ_sở` = tổng subtotal của TẤT CẢ đơn truyền vào — phải bằng đúng cơ sở đã dùng để tính
// `totalDiscount` (calculateDiscount) ở nơi gọi, để "Σ phần chia = tổng giảm" đúng từng đồng.
export function allocateDiscount(
  orders: readonly AllocationBasis[],
  totalDiscount: number,
): Map<string, number> {
  const zeros = new Map(orders.map((o) => [o.shopId, 0]));
  const base = orders.reduce((sum, o) => sum + o.subtotal, 0);
  if (orders.length === 0 || totalDiscount <= 0 || base <= 0) {
    return zeros;
  }

  // Không vượt cơ sở — an toàn dù caller lỡ truyền totalDiscount > tổng subtotal.
  const capped = Math.min(Math.floor(totalDiscount), Math.floor(base));
  const totalBig = BigInt(capped);
  const baseBig = BigInt(Math.floor(base));

  const rows = orders.map((o) => {
    const subtotalBig = BigInt(Math.floor(o.subtotal));
    const numerator = totalBig * subtotalBig;
    return {
      shopId: o.shopId,
      floorAmount: Number(numerator / baseBig),
      remainder: numerator % baseBig,
    };
  });

  const allocated = rows.reduce((sum, r) => sum + r.floorAmount, 0);
  const remaining = capped - allocated; // largest-remainder: luôn 0 <= remaining < orders.length

  const ranked = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.shopId < b.shopId ? -1 : a.shopId > b.shopId ? 1 : 0;
  });

  const result = new Map(rows.map((r) => [r.shopId, r.floorAmount]));
  for (let i = 0; i < remaining; i++) {
    const shopId = ranked[i].shopId;
    result.set(shopId, (result.get(shopId) ?? 0) + 1);
  }
  return result;
}

// --- buildCheckoutPlan ----------------------------------------------------------------------

export interface CheckoutPlanItem {
  cartItemId: string | null;
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  // Giá đã khoá lúc giữ chỗ (Week7.md 1.11 (2)), số nguyên VND.
  unitPrice: number;
  weightGram: number | null;
}

export interface CheckoutPlanShop {
  shopId: string;
  shopName: string;
  shopSlug: string;
  // Tỉnh lấy hàng của shop; Tuần 7 dùng readDefaultOriginProvince() vì shop chưa có địa chỉ.
  originProvince: string;
  items: CheckoutPlanItem[];
}

export interface CheckoutPlanVoucher {
  // null = voucher toàn sàn (chia theo allocateDiscount); có giá trị = voucher của đúng shop đó
  // (toàn bộ số giảm vào 1 đơn, không chia).
  shopId: string | null;
  // Tổng số giảm ĐÃ TÍNH SẴN (calculateDiscount, ở shared/utils), số nguyên VND.
  amount: number;
}

export interface CheckoutPlanInput {
  // Chỉ gồm các dòng ĐÃ LỌC còn khả dụng và được mua (Week7.md 1.12) — buildCheckoutPlan không tự lọc.
  shops: CheckoutPlanShop[];
  // Tỉnh giao — 1 địa chỉ dùng chung cho mọi đơn trong cùng lần checkout.
  destinationProvince: string;
  voucher: CheckoutPlanVoucher | null;
}

export interface CheckoutPlanOrder {
  shopId: string;
  shopName: string;
  shopSlug: string;
  items: CheckoutPlanItem[];
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  // = subtotal - discountAmount + shippingFee (Order.totalAmount).
  totalAmount: number;
}

export interface CheckoutPlan {
  orders: CheckoutPlanOrder[];
  subtotal: number;
  shippingTotal: number;
  // = Σ Order.discountAmount (VoucherUsage.discountAmount).
  discountTotal: number;
  // = Σ Order.totalAmount (Payment.amount).
  grandTotal: number;
}

function subtotalOf(shop: CheckoutPlanShop): number {
  return shop.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
}

// Voucher theo shop: toàn bộ số giảm vào đúng 1 đơn của shop đó, không chia — chặn (min) không vượt
// subtotal đơn đó làm lưới an toàn (nơi gọi đã tính amount trên đúng cơ sở subtotal shop, nên bình
// thường không chạm ngưỡng này). Shop trong voucher không có trong danh sách đơn (vd toàn bộ item
// của shop đã bị loại vì hết hàng) ⇒ không giảm gì, không ném lỗi — nơi gọi chịu trách nhiệm đảm bảo
// voucher chỉ áp khi shop đó còn ít nhất 1 đơn.
function resolveDiscountByShop(
  orders: ReadonlyArray<{ shopId: string; subtotal: number }>,
  voucher: CheckoutPlanVoucher | null,
): Map<string, number> {
  if (!voucher || voucher.amount <= 0) return new Map();

  if (voucher.shopId !== null) {
    const target = orders.find((o) => o.shopId === voucher.shopId);
    if (!target) return new Map<string, number>();
    return new Map<string, number>([
      [voucher.shopId, Math.min(voucher.amount, target.subtotal)],
    ]);
  }
  return allocateDiscount(orders, voucher.amount);
}

// Kế hoạch đơn dùng CHUNG bởi POST /checkout/preview (2.7b) và placeOrder (2.7) — 1 nguồn tính tiền
// duy nhất để "số buyer thấy = số bị tính" là điều kiện cấu trúc, không phải hy vọng. Hàm THUẦN,
// không đụng DB.
export function buildCheckoutPlan(
  input: CheckoutPlanInput,
  rates: ShippingRates = DEFAULT_SHIPPING_RATES,
): CheckoutPlan {
  const base = input.shops.map((shop) => ({
    shop,
    subtotal: subtotalOf(shop),
    shippingFee: calculateShippingFee(
      {
        originProvince: shop.originProvince,
        destinationProvince: input.destinationProvince,
        items: shop.items.map((item) => ({
          weightGram: item.weightGram,
          quantity: item.quantity,
        })),
      },
      rates,
    ),
  }));

  const discountByShop = resolveDiscountByShop(
    base.map(({ shop, subtotal }) => ({ shopId: shop.shopId, subtotal })),
    input.voucher,
  );

  const orders: CheckoutPlanOrder[] = base.map(
    ({ shop, subtotal, shippingFee }) => {
      const discountAmount = discountByShop.get(shop.shopId) ?? 0;
      return {
        shopId: shop.shopId,
        shopName: shop.shopName,
        shopSlug: shop.shopSlug,
        items: shop.items,
        subtotal,
        shippingFee,
        discountAmount,
        totalAmount: subtotal - discountAmount + shippingFee,
      };
    },
  );

  const sum = (pick: (o: CheckoutPlanOrder) => number) =>
    orders.reduce((total, order) => total + pick(order), 0);

  return {
    orders,
    subtotal: sum((o) => o.subtotal),
    shippingTotal: sum((o) => o.shippingFee),
    discountTotal: sum((o) => o.discountAmount),
    grandTotal: sum((o) => o.totalAmount),
  };
}
