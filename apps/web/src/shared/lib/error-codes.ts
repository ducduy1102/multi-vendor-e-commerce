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
  // Đổi / quên mật khẩu (Week9.md 1.11)
  CURRENT_PASSWORD_INCORRECT: 'auth.errorCurrentPasswordIncorrect',
  PASSWORD_NOT_SET: 'auth.errorPasswordNotSet',
  RESET_TOKEN_INVALID: 'auth.errorResetTokenInvalid',
  // Xác thực email (Week10.md 2.2) — dùng lại key đã có ở trang /verify-email và nút gửi lại.
  VERIFY_TOKEN_INVALID: 'auth.verifyEmailInvalidOrExpired',
  EMAIL_ALREADY_VERIFIED: 'auth.resendVerificationAlreadyVerified',
  VERIFICATION_RESEND_TOO_SOON: 'auth.resendVerificationTooFast',
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
  CART_OWN_SHOP_ITEM: 'cart.errorOwnShopItem',
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
  // Yêu cầu hủy/trả hàng (Week9.md 1.3/1.4)
  REFUND_REQUEST_NOT_ALLOWED: 'order.errorRefundRequestNotAllowed',
  REFUND_REQUEST_NOT_FOUND: 'order.errorRefundRequestNotFound',
  REFUND_REQUEST_INVALID_TRANSITION: 'order.errorRefundRequestInvalidTransition',
  REFUND_REQUEST_PENDING: 'order.errorRefundRequestPending',
  // Hoàn tiền ra khỏi hệ thống (chỉ màn Admin gặp)
  PAYMENT_REFUND_NOT_FOUND: 'admin.errorPaymentRefundNotFound',
  PAYMENT_REFUND_NOT_RETRYABLE: 'admin.errorPaymentRefundNotRetryable',
  PAYMENT_NOT_REFUNDABLE: 'admin.errorPaymentNotRefundable',
  // Đánh giá sản phẩm (Week9.md 1.8)
  REVIEW_NOT_ALLOWED: 'review.errorNotAllowed',
  REVIEW_NOT_FOUND: 'review.errorNotFound',
  REVIEW_EDIT_NOT_ALLOWED: 'review.errorEditNotAllowed',
  // Shop: chuyển trạng thái (Admin duyệt/từ chối/khoá, chủ shop gửi duyệt lại) và sửa thông tin
  SHOP_INVALID_TRANSITION: 'shop.errorInvalidTransition',
  SHOP_EDIT_NOT_ALLOWED: 'shop.errorEditNotAllowed',
  // Sản phẩm: biến thể có nhiều ảnh hơn trần (Week10.md 2.4) — giao diện đã chặn nên chỉ gặp khi gọi API thẳng.
  PRODUCT_IMAGES_LIMIT_EXCEEDED: 'product.errorImagesLimitExceeded',
  // Chat người mua ↔ shop (Week10.md 4.2)
  CHAT_OWN_SHOP: 'chat.errorOwnShop',
  CHAT_SHOP_UNAVAILABLE: 'chat.errorShopUnavailable',
  CHAT_RATE_LIMITED: 'chat.errorRateLimited',
  CHAT_AWAITING_REPLY: 'chat.errorAwaitingReply',
  CHAT_CONVERSATION_LIMIT: 'chat.errorConversationLimit',
  CHAT_NOT_PARTICIPANT: 'chat.errorNotParticipant',
  // Quản lý người dùng của Admin (Week11.md Bước 3)
  USER_NOT_FOUND: 'admin.errorUserNotFound',
  USER_INVALID_TRANSITION: 'admin.errorUserInvalidTransition',
  CANNOT_MODIFY_ADMIN: 'admin.errorCannotModifyAdmin',
  CANNOT_MODIFY_SELF: 'admin.errorCannotModifySelf',
  SHOP_OWNER_NOT_ACTIVE: 'admin.errorShopOwnerNotActive',
  SHOP_NOT_SUSPENDED: 'admin.errorShopNotSuspended',
  // Ghi chú nội bộ của Admin (Week11.md 4.3)
  ADMIN_NOTE_TARGET_NOT_FOUND: 'admin.errorNoteTargetNotFound',
  // Kháng nghị của shop (Week11.md 4.6)
  APPEAL_NOT_ALLOWED: 'appeal.errorNotAllowed',
  APPEAL_ALREADY_SENT: 'appeal.errorAlreadySent',
  APPEAL_NOT_FOUND: 'admin.errorAppealNotFound',
  APPEAL_ALREADY_DECIDED: 'admin.errorAppealAlreadyDecided',
  APPEAL_TARGET_CHANGED: 'admin.errorAppealTargetChanged',
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
