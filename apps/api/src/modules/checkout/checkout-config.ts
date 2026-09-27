import { z } from 'zod';

// Số nhóm chờ thanh toán tối đa (có Order AWAITING_PAYMENT) trên mỗi user (Week7.md 1.11 (5)) —
// chống giữ chỗ tồn kho hàng loạt không trả tiền. Đọc LÚC DÙNG, ENV optional dùng
// `?.trim() || fallback`, không `??` (rules/general.md mục 4).
const DEFAULT_MAX_PENDING_CHECKOUTS = 3;

export function readMaxPendingCheckouts(): number {
  const raw =
    process.env.MAX_PENDING_CHECKOUTS?.trim() ||
    String(DEFAULT_MAX_PENDING_CHECKOUTS);
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_MAX_PENDING_CHECKOUTS;
}
