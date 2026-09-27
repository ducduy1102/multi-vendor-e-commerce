import { VoucherType } from '@prisma/client';

export interface DiscountRule {
  type: VoucherType;
  value: number;
  maxDiscountAmount: number | null;
}

// Hàm thuần duy nhất tính số tiền giảm (Week6.md 1.11b) — preview ở /cart và tạo Order thật ở
// checkout phải dùng chung để số không lệch nhau. Tiền là số nguyên đồng, làm tròn XUỐNG (buyer
// không bị trừ nhiều hơn số đã thấy). Đặt ở shared/ vì ≥ 2 module cần (voucher, checkout).
// PERCENT: floor(base × value / 100) → cap theo maxDiscountAmount → không vượt base.
// FIXED: min(value, base).
//
// PERCENT dùng số học nguyên (BigInt) thay vì số thực: `Voucher.value` là Decimal(12,2) nên phần
// trăm có thể lẻ (12,5%; 0,29%) và `base × value / 100` bằng số thực bị sai số dấu phẩy động —
// vd 50.000 × 0,29% ra 144 thay vì đúng 145 (Week7.md 1.6). Phần trăm nguyên cho kết quả không đổi.
const PERCENT_SCALE = 100; // value có tối đa 2 chữ số thập phân → nhân 100 ra số nguyên chính xác

export function calculateDiscount(rule: DiscountRule, base: number): number {
  if (base <= 0) {
    return 0;
  }
  let amount: number;
  if (rule.type === VoucherType.PERCENT) {
    amount = percentOf(base, rule.value);
    if (rule.maxDiscountAmount !== null) {
      amount = Math.min(amount, Math.floor(rule.maxDiscountAmount));
    }
  } else {
    amount = Math.floor(rule.value);
  }
  return Math.max(0, Math.min(amount, base));
}

// floor(base × percent / 100) chính xác. Math.round chỉ để bỏ sai số biểu diễn của số có tối đa
// 2 chữ số thập phân (0,29 × 100 = 28,999999999999996 → 29), không làm tròn giá trị thật.
function percentOf(base: number, percent: number): number {
  const scaledPercent = BigInt(Math.round(percent * PERCENT_SCALE));
  const result =
    (BigInt(Math.floor(base)) * scaledPercent) / BigInt(100 * PERCENT_SCALE);
  return Number(result);
}
