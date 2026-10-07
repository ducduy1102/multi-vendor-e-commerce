import { readPositiveInt } from '../../shared/utils/read-positive-int';

// Cấu hình hủy/trả hàng/hoàn tiền (Week9.md 1.3/1.5). Mọi hàm đọc ENV LÚC DÙNG, không lúc boot
// (rules/backend.md mục 8); biến không khai/để trống/không phải số nguyên dương ⇒ về mặc định.

// Số ngày kể từ lúc đơn COMPLETED mà người mua còn gửi được yêu cầu trả hàng/hoàn tiền. Quá hạn ⇒
// REFUND_REQUEST_NOT_ALLOWED (WINDOW_EXPIRED) và cờ canRequestReturn tắt.
const DEFAULT_REFUND_WINDOW_DAYS = 7;

export function readRefundWindowDays(): number {
  return readPositiveInt('REFUND_WINDOW_DAYS', DEFAULT_REFUND_WINDOW_DAYS);
}
