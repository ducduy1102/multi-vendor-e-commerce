import type { PaymentMethod } from './types';

// Câu nhắc kèm lỗi mạng/phản hồi hỏng lúc đặt hàng (kết quả KHÔNG rõ: đơn có thể đã được tạo).
// Cổng online nhắc về TIỀN ("nếu tiền đã bị trừ…"), còn COD không trừ tiền gì nên câu đó sẽ gây
// hiểu nhầm — COD chỉ cần nhắc kiểm tra "Đơn hàng của tôi" trước khi đặt lại để khỏi đặt trùng.
export function getUnknownResultHintKey(
  method: PaymentMethod,
): 'placeOrderUnknownResultHint' | 'placeOrderUnknownResultHintCod' {
  return method === 'COD' ? 'placeOrderUnknownResultHintCod' : 'placeOrderUnknownResultHint';
}
