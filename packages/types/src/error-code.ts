import { z } from 'zod';
import { paymentMethodSchema, paymentMethodUnavailableReasonSchema } from './payment';

// Mã lỗi máy đọc được (Week7.md 1.16). Response lỗi có dạng
//   { success: false, data: null, message, code?, details? }
// - `message`: tiếng Anh cho log/Swagger/người phát triển, GIỮ NGUYÊN khi di chuyển lỗi cũ sang có mã;
//   FE không hiện cho người dùng ở các Container mới mà dịch theo `code`.
// - `code`: SCREAMING_SNAKE ỔN ĐỊNH (hợp đồng FE-BE, không đổi tên sau khi phát hành). Là lớp phân biệt mịn
//   hơn của status HTTP (409/400...), không thay status.
// - `details`: object khai kiểu theo từng mã (ErrorDetailsMap), chỉ chứa thứ FE cần.
// Lỗi không có `code` (validate Zod, lỗi cũ chưa di chuyển) giữ nguyên hình dạng cũ.

// Mã do BE trả.
export const SERVER_ERROR_CODES = [
  // Auth
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_NOT_ACTIVE',
  // Voucher
  'VOUCHER_NOT_FOUND',
  'VOUCHER_INACTIVE',
  'VOUCHER_EXPIRED',
  'VOUCHER_USAGE_LIMIT_REACHED',
  'VOUCHER_PER_USER_LIMIT_REACHED',
  'VOUCHER_NOT_APPLICABLE',
  'VOUCHER_BELOW_MINIMUM',
  'VOUCHER_CODE_EXISTS',
  // Giỏ hàng
  'CART_FULL',
  'CART_ITEM_UNAVAILABLE',
  'INSUFFICIENT_STOCK',
  // Checkout
  'NO_PURCHASABLE_ITEMS',
  'OUT_OF_STOCK',
  'PRICE_CHANGED',
  'CART_CHANGED',
  'TOO_MANY_PENDING_CHECKOUTS',
  'PAYMENT_METHOD_UNAVAILABLE',
  'ADDRESS_LIMIT_REACHED',
  'PAYMENT_RETRY_NOT_ALLOWED',
  // Đơn hàng
  'ORDER_NOT_FOUND',
  'ORDER_INVALID_TRANSITION',
  'ORDER_CANCEL_NOT_ALLOWED',
  'ORDER_ALREADY_CHANGED',
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

// Mã do CLIENT tự sinh (không từ BE): mất mạng/timeout, và phản hồi không phải JSON/envelope hỏng
// (vd 502 từ proxy). Chỉ 2 mã này nghĩa là "chưa biết đơn đã tạo hay chưa" ⇒ giữ Idempotency-Key và
// cho thử lại; mọi mã nghiệp vụ khác là kết quả chắc chắn.
export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'INVALID_RESPONSE'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export const ERROR_CODES = [...SERVER_ERROR_CODES, ...CLIENT_ERROR_CODES] as const;
export type ErrorCode = ServerErrorCode | ClientErrorCode;

// Zod schema cho `details` của từng mã có details — details từ BE cũng là dữ liệu ngoài, FE phải parse.
export const errorDetailsSchemas = {
  VOUCHER_BELOW_MINIMUM: z.object({
    // Số nguyên VND — thay cho regex bóc số từ chữ ở message.
    minAmount: z.number().int().nonnegative(),
  }),
  CART_FULL: z.object({ maxLines: z.number().int().positive() }),
  INSUFFICIENT_STOCK: z.object({ available: z.number().int().nonnegative() }),
  OUT_OF_STOCK: z.object({
    items: z.array(
      z.object({
        productVariantId: z.string(),
        productName: z.string(),
        variantLabel: z.string().nullable(),
        available: z.number().int().nonnegative(),
      }),
    ),
  }),
  PRICE_CHANGED: z.object({
    expectedTotal: z.number().int().nonnegative(),
    currentTotal: z.number().int().nonnegative(),
  }),
  // Chỉ nhóm CỦA CHÍNH user, tối đa MAX_PENDING_CHECKOUTS.
  TOO_MANY_PENDING_CHECKOUTS: z.object({ pendingGroupIds: z.array(z.string()) }),
  PAYMENT_METHOD_UNAVAILABLE: z.object({
    method: paymentMethodSchema,
    reason: paymentMethodUnavailableReasonSchema,
  }),
  PAYMENT_RETRY_NOT_ALLOWED: z.object({
    reason: z.enum(['ATTEMPT_PENDING', 'HOLD_EXPIRED', 'ALREADY_PAID']),
  }),
  // PAID_ONLINE: đơn đã thanh toán online (hủy + hoàn tiền: Tuần 9); PROCESSING_STARTED: shop đã xác
  // nhận hoặc đã xử lý tiếp (hủy sau xác nhận: Tuần 9).
  ORDER_CANCEL_NOT_ALLOWED: z.object({
    reason: z.enum(['PAID_ONLINE', 'PROCESSING_STARTED']),
  }),
} as const;

// Kiểu `details` theo từng mã: mã KHÔNG có trong map là mã không có details.
export type ErrorDetailsMap = {
  [K in keyof typeof errorDetailsSchemas]: z.infer<(typeof errorDetailsSchemas)[K]>;
};

export type ErrorCodeWithDetails = keyof ErrorDetailsMap;

export function hasErrorDetails(code: string): code is ErrorCodeWithDetails {
  return code in errorDetailsSchemas;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

// Body lỗi từ BE. `code`/`details` chỉ có ở lỗi đã di chuyển sang có mã.
export const apiErrorBodySchema = z.object({
  success: z.literal(false),
  data: z.null(),
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
