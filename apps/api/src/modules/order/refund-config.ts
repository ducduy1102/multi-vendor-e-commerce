import { readPositiveInt } from '../../shared/utils/read-positive-int';

// Cấu hình hủy/trả hàng/hoàn tiền (Week9.md 1.3/1.5). Mọi hàm đọc ENV LÚC DÙNG, không lúc boot
// (rules/backend.md mục 8); biến không khai/để trống/không phải số nguyên dương ⇒ về mặc định.

// Số ngày kể từ lúc đơn COMPLETED mà người mua còn gửi được yêu cầu trả hàng/hoàn tiền. Quá hạn ⇒
// REFUND_REQUEST_NOT_ALLOWED (WINDOW_EXPIRED) và cờ canRequestReturn tắt.
const DEFAULT_REFUND_WINDOW_DAYS = 7;

export function readRefundWindowDays(): number {
  return readPositiveInt('REFUND_WINDOW_DAYS', DEFAULT_REFUND_WINDOW_DAYS);
}

// Thời gian tối đa chờ cổng trả lời MỘT lần gọi hoàn tiền (ms). Hết hạn ⇒ coi khoản hoàn là PENDING (chưa
// biết cổng đã nhận hay chưa) và để RefundJob / Admin thử lại bằng cùng mã tham chiếu — không giữ request
// của người dùng chờ cổng chậm.
const DEFAULT_REFUND_GATEWAY_TIMEOUT_MS = 8000;

export function readRefundGatewayTimeoutMs(): number {
  return readPositiveInt(
    'REFUND_GATEWAY_TIMEOUT_MS',
    DEFAULT_REFUND_GATEWAY_TIMEOUT_MS,
  );
}

// Khoản hoàn PENDING lâu hơn mức này (tính từ updatedAt, mỗi lần thử làm mới mốc) mới bị coi là "bị bỏ
// dở": Admin được thử lại/ghi nhận thủ công và RefundJob quét lại. Không phải ENV — đủ dài để một lần gọi
// cổng đang chạy (timeout 8s) không bị nhận nhầm là bỏ dở, đủ ngắn để người mua không chờ lâu.
export const REFUND_PENDING_STALE_MS = 5 * 60 * 1000;
