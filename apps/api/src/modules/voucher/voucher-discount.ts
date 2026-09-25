import { VoucherType } from '@prisma/client';

export interface DiscountRule {
  type: VoucherType;
  value: number;
  maxDiscountAmount: number | null;
}

// Hàm thuần duy nhất tính số tiền giảm (Week6.md 1.11b) — preview ở /cart và
// tạo Order thật ở Tuần 7 phải dùng chung để số không lệch nhau. Tiền là số
// nguyên đồng, làm tròn XUỐNG (buyer không bị trừ nhiều hơn số đã thấy).
// PERCENT: floor(base × value / 100) → cap theo maxDiscountAmount → không
// vượt base. FIXED: min(value, base).
export function calculateDiscount(rule: DiscountRule, base: number): number {
  if (base <= 0) {
    return 0;
  }
  let amount: number;
  if (rule.type === VoucherType.PERCENT) {
    amount = Math.floor((base * rule.value) / 100);
    if (rule.maxDiscountAmount !== null) {
      amount = Math.min(amount, Math.floor(rule.maxDiscountAmount));
    }
  } else {
    amount = Math.floor(rule.value);
  }
  return Math.max(0, Math.min(amount, base));
}
