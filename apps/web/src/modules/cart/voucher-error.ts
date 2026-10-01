import type { ErrorCode } from '@ecommerce/types';

import { ERROR_CODE_MESSAGE_KEYS, getErrorDetails } from '@/shared/lib/error-codes';

// Lỗi khi áp mã giảm giá ở giỏ hàng, đã bóc từ ApiError (Week7.md 1.16) — cùng shape
// `useCart` trả về ở field `voucherError`.
export interface VoucherErrorState {
  code: ErrorCode | undefined;
  details: unknown;
}

export interface VoucherErrorInfo {
  // Key i18n ĐẦY ĐỦ (kèm namespace, vd 'cart.voucherNotFound') — CartSummary dịch bằng
  // translator TOÀN CỤC (useTranslations(), không cố định namespace), giống cách
  // useApiErrorMessage/useValidationMessage đã dịch message dạng key.
  key: string;
  // Chỉ có giá trị khi code = VOUCHER_BELOW_MINIMUM: số nguyên VND, FE tự formatPrice.
  minAmount?: number;
}

const VOUCHER_ERROR_CODES: readonly ErrorCode[] = [
  'VOUCHER_NOT_FOUND',
  'VOUCHER_INACTIVE',
  'VOUCHER_EXPIRED',
  'VOUCHER_USAGE_LIMIT_REACHED',
  'VOUCHER_PER_USER_LIMIT_REACHED',
  'VOUCHER_NOT_APPLICABLE',
  'VOUCHER_BELOW_MINIMUM',
];

const GENERIC_KEY = 'cart.voucherGenericError';

// BE (AllExceptionsFilter, sau Week7.md 2.2c) trả `code` máy đọc được cho mọi lỗi validate
// voucher — thay cho việc suy đoán theo nội dung `message` tiếng Anh (cách cũ, giòn: BE đổi
// câu chữ là vỡ, ràng buộc ngầm với voucher.service.ts). `code` thiếu (lỗi khác chưa di
// chuyển) hoặc lạ (BE thêm lý do mới, FE chưa cập nhật `VOUCHER_ERROR_CODES`) đều rơi về
// lỗi chung, không vỡ UI.
export function classifyVoucherError(error: VoucherErrorState): VoucherErrorInfo {
  const { code, details } = error;
  if (!code || !VOUCHER_ERROR_CODES.includes(code)) {
    return { key: GENERIC_KEY };
  }
  if (code === 'VOUCHER_BELOW_MINIMUM') {
    const parsed = getErrorDetails(details, 'VOUCHER_BELOW_MINIMUM');
    return { key: ERROR_CODE_MESSAGE_KEYS[code], minAmount: parsed?.minAmount };
  }
  return { key: ERROR_CODE_MESSAGE_KEYS[code] };
}
