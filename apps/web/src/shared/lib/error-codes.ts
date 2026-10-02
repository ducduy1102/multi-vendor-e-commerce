import {
  errorDetailsSchemas,
  isErrorCode,
  type ErrorCode,
  type ErrorCodeWithDetails,
  type ErrorDetailsMap,
} from '@ecommerce/types';
import type { z } from 'zod';

import type { ApiError } from './api-client';

// Ánh xạ mã lỗi (Week7.md 1.16, ERROR_CODES ở packages/types) sang key i18n ĐẦY ĐỦ (kèm
// namespace) — dịch bằng `useTranslations()` global (không namespace cố định, vì các mã trải
// trên nhiều namespace khác nhau), cùng cách `useApiErrorMessage`/`useValidationMessage` đã làm
// cho message dạng key. Ưu tiên DÙNG LẠI key đã có bản dịch (vd 7 mã voucher trùng đúng các key
// `cart.voucherX` đã tồn tại từ Tuần 6) thay vì tạo key trùng nội dung — chỉ thêm key mới khi
// chưa có key nào diễn đạt đúng ý (rules/general.md mục 4 tinh thần "không định nghĩa lại 2 nơi").
export const ERROR_CODE_MESSAGE_KEYS: Record<ErrorCode, string> = {
  // Auth
  EMAIL_NOT_VERIFIED: 'auth.errorEmailNotVerified',
  ACCOUNT_NOT_ACTIVE: 'auth.loginGoogleErrorAccountNotActive',
  // Voucher (áp mã ở giỏ hàng) — dùng lại đúng 7 key đã có từ Tuần 6.
  VOUCHER_NOT_FOUND: 'cart.voucherNotFound',
  VOUCHER_INACTIVE: 'cart.voucherInactive',
  VOUCHER_EXPIRED: 'cart.voucherExpired',
  VOUCHER_USAGE_LIMIT_REACHED: 'cart.voucherUsageLimit',
  VOUCHER_PER_USER_LIMIT_REACHED: 'cart.voucherPerUserLimit',
  VOUCHER_NOT_APPLICABLE: 'cart.voucherNotApplicable',
  VOUCHER_BELOW_MINIMUM: 'cart.voucherMinOrder',
  // Voucher (Seller tạo mã trùng — module voucher, khác voucher áp ở giỏ) — dùng lại key đã có,
  // hiện đang được SellerVouchersContainer nhận diện qua status 409 (không phải qua code).
  VOUCHER_CODE_EXISTS: 'voucher.createConflict',
  // Giỏ hàng
  CART_FULL: 'cart.cartFull',
  CART_ITEM_UNAVAILABLE: 'cart.errorItemUnavailable',
  INSUFFICIENT_STOCK: 'cart.errorInsufficientStock',
  // Checkout
  NO_PURCHASABLE_ITEMS: 'checkout.errorNoPurchasableItems',
  OUT_OF_STOCK: 'checkout.errorOutOfStock',
  PRICE_CHANGED: 'checkout.errorPriceChanged',
  CART_CHANGED: 'checkout.errorCartChanged',
  TOO_MANY_PENDING_CHECKOUTS: 'checkout.errorTooManyPendingCheckouts',
  PAYMENT_METHOD_UNAVAILABLE: 'checkout.errorPaymentMethodUnavailable',
  ADDRESS_LIMIT_REACHED: 'checkout.errorAddressLimitReached',
  PAYMENT_RETRY_NOT_ALLOWED: 'checkout.errorPaymentRetryNotAllowed',
  // Đơn hàng
  ORDER_NOT_FOUND: 'order.errorNotFound',
  ORDER_INVALID_TRANSITION: 'order.errorInvalidTransition',
  ORDER_CANCEL_NOT_ALLOWED: 'order.errorCancelNotAllowed',
  ORDER_ALREADY_CHANGED: 'order.errorAlreadyChanged',
  // Admin duyệt/khoá shop
  SHOP_INVALID_TRANSITION: 'admin.errorShopInvalidTransition',
  // Lỗi CLIENT tự sinh (mất mạng / phản hồi hỏng) — Week7.md 1.11/1.16: nghĩa là
  // "chưa rõ kết quả", khác các mã nghiệp vụ ở trên (luôn là kết quả chắc chắn).
  NETWORK_ERROR: 'common.errorNetwork',
  INVALID_RESPONSE: 'common.errorInvalidResponse',
};

// Narrow `ApiError.code` (string thô từ response) về `ErrorCode` đã biết — lỗi cũ chưa di
// chuyển hoặc mã lạ (BE thêm sau, FE chưa cập nhật) trả `undefined`, KHÔNG ném lỗi.
export function getErrorCode(error: ApiError): ErrorCode | undefined {
  return error.code !== undefined && isErrorCode(error.code) ? error.code : undefined;
}

// Parse `details` (dữ liệu ngoài, không tin nguyên xi) bằng đúng Zod schema của mã đó
// (errorDetailsSchemas, packages/types). Mã không có details hoặc details sai hình dạng
// (BE đổi shape mà FE code cũ) đều trả `undefined` thay vì ném lỗi — Container rơi về
// hiển thị chung chung, không vỡ UI.
export function getErrorDetails<C extends ErrorCodeWithDetails>(
  details: unknown,
  code: C,
): ErrorDetailsMap[C] | undefined {
  // Lookup theo key generic C khiến TS suy ra union của MỌI schema (rồi giao lại thành `never`
  // vì các schema có field trùng tên khác kiểu, vd `reason`) thay vì đúng 1 schema ứng với C —
  // ép kiểu tường minh vì đã biết chắc `errorDetailsSchemas[code]` khớp `ErrorDetailsMap[C]`
  // (2 map định nghĩa cùng lúc ở packages/types/src/error-code.ts).
  const schema = errorDetailsSchemas[code] as unknown as z.ZodType<ErrorDetailsMap[C]>;
  const parsed = schema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
}
