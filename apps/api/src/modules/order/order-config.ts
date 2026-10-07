import { readPositiveInt } from '../../shared/utils/read-positive-int';

// Số ngày sau khi shop giao hàng (SHIPPING) mà buyer vẫn không bấm "Đã nhận hàng" thì hệ thống tự hoàn
// tất đơn (Week8.md 1.7). Nếu không có bước này, đơn kẹt SHIPPING mãi ⇒ không bao giờ review được (Tuần
// 9) và COD không bao giờ được ghi nhận đã thu tiền. Đọc LÚC DÙNG, không lúc boot.
const DEFAULT_ORDER_AUTO_COMPLETE_DAYS = 7;

export function readOrderAutoCompleteDays(): number {
  return readPositiveInt(
    'ORDER_AUTO_COMPLETE_DAYS',
    DEFAULT_ORDER_AUTO_COMPLETE_DAYS,
  );
}
