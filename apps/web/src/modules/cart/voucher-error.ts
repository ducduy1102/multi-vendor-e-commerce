export type VoucherErrorKey =
  | 'voucherNotFound'
  | 'voucherInactive'
  | 'voucherExpired'
  | 'voucherUsageLimit'
  | 'voucherPerUserLimit'
  | 'voucherMinOrder'
  | 'voucherNotApplicable'
  | 'voucherGenericError';

export interface VoucherErrorInfo {
  key: VoucherErrorKey;
  // Chỉ có với voucherMinOrder: mức tối thiểu BE nêu trong message (chuỗi số).
  minAmount?: string;
}

// BE (AllExceptionsFilter) chỉ trả 1 chuỗi message tiếng Anh, không có mã lỗi
// máy đọc được, nên FE phải nhận diện lý do theo nội dung message để hiện bản
// dịch vi/en thay vì lộ tiếng Anh cho người dùng. Đây là ràng buộc ngầm với
// các message trong apps/api/src/modules/voucher/voucher.service.ts — đổi
// câu chữ ở đó thì phải sửa ở đây (rơi về voucherGenericError, không vỡ UI).
// Cách bền hơn là mở rộng filter dùng chung trả thêm `code` (cần hỏi trước
// vì đổi file dùng chung — ghi ở Week6.md 2.4).
export function classifyVoucherError(message: string): VoucherErrorInfo {
  const text = message.trim();
  if (text === 'Voucher not found') return { key: 'voucherNotFound' };
  if (text === 'Voucher is not active') return { key: 'voucherInactive' };
  if (text === 'Voucher has expired') return { key: 'voucherExpired' };
  if (text === 'Voucher usage limit has been reached') return { key: 'voucherUsageLimit' };
  if (text === 'You have reached the usage limit for this voucher') {
    return { key: 'voucherPerUserLimit' };
  }
  if (text === 'Voucher does not apply to any item in your cart') {
    return { key: 'voucherNotApplicable' };
  }
  const minOrder = /^Order amount is below the voucher minimum \(([\d.]+)\)$/.exec(text);
  if (minOrder) return { key: 'voucherMinOrder', minAmount: minOrder[1] };
  return { key: 'voucherGenericError' };
}
