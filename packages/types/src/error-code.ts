import { z } from 'zod';
import { paymentMethodSchema, paymentMethodUnavailableReasonSchema } from './payment';
import { shopStatusSchema } from './shop';

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
  // Đổi / quên mật khẩu (Week9.md 1.11). CURRENT_PASSWORD_INCORRECT: mật khẩu hiện tại sai khi đổi;
  // PASSWORD_NOT_SET: tài khoản chỉ đăng nhập Google chưa có mật khẩu để "đổi" (đi luồng quên mật khẩu để
  // đặt lần đầu); RESET_TOKEN_INVALID: token đặt lại sai / hết hạn / đã dùng — MỘT mã cho cả ba ca để không
  // lộ token từng tồn tại hay không.
  'CURRENT_PASSWORD_INCORRECT',
  'PASSWORD_NOT_SET',
  'RESET_TOKEN_INVALID',
  // Xác thực email. VERIFY_TOKEN_INVALID: token sai / đã hết hạn / đã dùng — MỘT mã cho cả ca (cùng tinh thần
  // RESET_TOKEN_INVALID, không lộ token từng tồn tại hay không); EMAIL_ALREADY_VERIFIED: gửi lại email xác
  // thực cho tài khoản đã xác thực; VERIFICATION_RESEND_TOO_SOON (429): còn trong thời gian chờ giữa hai lần
  // gửi lại.
  'VERIFY_TOKEN_INVALID',
  'EMAIL_ALREADY_VERIFIED',
  'VERIFICATION_RESEND_TOO_SOON',
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
  // Người bán không được mua sản phẩm của CHÍNH shop mình (thêm vào giỏ / sửa dòng giỏ): chặn tự mua rồi tự đánh
  // giá để nâng điểm. Dòng đã nằm sẵn trong giỏ từ trước thì bị loại khỏi thanh toán như dòng không khả dụng.
  'CART_OWN_SHOP_ITEM',
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
  // Yêu cầu hủy/trả hàng của người mua (Week9.md 1.3/1.4). NOT_ALLOWED kèm details.reason; INVALID_TRANSITION
  // gộp "sai trạng thái lúc đọc" và "thua race" như SHOP_INVALID_TRANSITION; PENDING = seller đóng gói/giao
  // đơn trong lúc người mua đang xin hủy (phải trả lời yêu cầu trước).
  'REFUND_REQUEST_NOT_ALLOWED',
  'REFUND_REQUEST_NOT_FOUND',
  'REFUND_REQUEST_INVALID_TRANSITION',
  'REFUND_REQUEST_PENDING',
  // Hoàn tiền ra khỏi hệ thống (sổ cái PaymentRefund, màn Admin): không có khoản hoàn đó, khoản hoàn không
  // ở trạng thái thử lại được, thanh toán không còn gì để hoàn.
  'PAYMENT_REFUND_NOT_FOUND',
  'PAYMENT_REFUND_NOT_RETRYABLE',
  'PAYMENT_NOT_REFUNDABLE',
  // Đánh giá sản phẩm (Week9.md 1.8). EDIT_NOT_ALLOWED = đã sửa một lần rồi (hoặc không phải của mình ở
  // chỗ không muốn lộ là có đánh giá).
  'REVIEW_NOT_ALLOWED',
  'REVIEW_NOT_FOUND',
  'REVIEW_EDIT_NOT_ALLOWED',
  // Ẩn / hiện đánh giá (Week11.md 5.5). REVIEW_HIDDEN (409): tác giả sửa đánh giá đã bị Admin ẩn. REVIEW_ALREADY_HIDDEN (409) /
  // REVIEW_NOT_HIDDEN (409): Admin ẩn đánh giá đã ẩn / mở lại đánh giá chưa bị ẩn (gộp "sai trạng thái lúc đọc" và "thua race").
  'REVIEW_HIDDEN',
  'REVIEW_ALREADY_HIDDEN',
  'REVIEW_NOT_HIDDEN',
  // Chuyển trạng thái shop (Admin duyệt/từ chối/khoá/mở khoá, chủ shop gửi duyệt lại): shop không còn ở
  // trạng thái cho phép chuyển (đã có người khác xử lý, hoặc cạnh/actor không có trong
  // SHOP_STATUS_TRANSITIONS) — gộp "sai trạng thái lúc đọc" và "thua race" làm 1 vì với người dùng cả hai
  // đều nghĩa là dữ liệu đang xem đã cũ.
  'SHOP_INVALID_TRANSITION',
  // Sửa thông tin shop khi trạng thái không cho phép (PENDING đang chờ duyệt, SUSPENDED đang bị khoá) —
  // details.status cho FE giải thích đúng lý do.
  'SHOP_EDIT_NOT_ALLOWED',
  // Sản phẩm: một biến thể có nhiều ảnh hơn PRODUCT_VARIANT_MAX_IMAGES (Week10.md 2.4). Giao diện đã chặn từ
  // trước nên chỉ gặp khi gọi API thẳng; biến thể cũ ĐÃ vượt trần mà không thêm ảnh thì không bị lỗi này.
  'PRODUCT_IMAGES_LIMIT_EXCEEDED',
  // Chat người mua ↔ shop (Week10.md 4.2). OWN_SHOP: chủ shop không nhắn tin cho shop của chính mình (409);
  // SHOP_UNAVAILABLE: shop không còn APPROVED nên hội thoại chỉ đọc, không gửi thêm được (409); RATE_LIMITED:
  // gửi quá nhanh trong cửa sổ ngắn (429); AWAITING_REPLY: đã gửi quá nhiều tin liên tiếp khi shop chưa trả lời
  // (429); CONVERSATION_LIMIT: mở quá nhiều hội thoại MỚI trong một ngày (429); NOT_PARTICIPANT: dành cho nơi
  // thật sự cần báo "không phải thành viên" — người ngoài hội thoại luôn nhận 404 (không lộ hội thoại tồn tại).
  'CHAT_OWN_SHOP',
  'CHAT_SHOP_UNAVAILABLE',
  'CHAT_RATE_LIMITED',
  'CHAT_AWAITING_REPLY',
  'CHAT_CONVERSATION_LIMIT',
  'CHAT_NOT_PARTICIPANT',
  // Quản lý người dùng của Admin (Week11.md Bước 3, D2). USER_NOT_FOUND (404): không có người dùng đó;
  // USER_INVALID_TRANSITION (409): tài khoản không còn ở trạng thái cho phép chuyển (đã có Admin khác xử lý, hoặc cạnh
  // không có trong ADMIN_ACCOUNT_STATUS_TRANSITIONS) — gộp "sai trạng thái lúc đọc" và "thua race" như
  // SHOP_INVALID_TRANSITION; CANNOT_MODIFY_ADMIN / CANNOT_MODIFY_SELF (409): không khoá được tài khoản Admin khác hay
  // chính mình; SHOP_OWNER_NOT_ACTIVE (409): không duyệt được shop khi chủ shop đang bị khoá hoặc cấm.
  'USER_NOT_FOUND',
  'USER_INVALID_TRANSITION',
  'CANNOT_MODIFY_ADMIN',
  'CANNOT_MODIFY_SELF',
  'SHOP_OWNER_NOT_ACTIVE',
  // Hủy hàng loạt đơn của shop (Week11.md 4.1): chỉ làm được khi shop ĐANG bị khoá (409) — shop đã được mở lại hoặc chưa từng
  // bị khoá thì đơn của nó vẫn là việc bình thường của chủ shop, không được Admin hủy hàng loạt.
  'SHOP_NOT_SUSPENDED',
  // Ghi chú nội bộ của Admin (Week11.md 4.3): người dùng hoặc shop được gắn ghi chú không tồn tại (404). MỘT mã cho cả hai loại
  // đối tượng và cho id sai dạng, như USER_NOT_FOUND.
  'ADMIN_NOTE_TARGET_NOT_FOUND',
  // Kháng nghị của shop (Week11.md 4.6). APPEAL_NOT_ALLOWED (409): shop không ở trạng thái được kháng nghị (không phải SUSPENDED, hoặc
  // bị khoá theo cascade tài khoản). APPEAL_ALREADY_SENT (409): lần khoá này đã có kháng nghị (mỗi lần bị xử lý chỉ một lần).
  // APPEAL_NOT_FOUND (404): Admin quyết định một kháng nghị không tồn tại / id sai dạng. APPEAL_ALREADY_DECIDED (409): kháng nghị
  // đã có kết quả (người khác quyết trước). APPEAL_TARGET_CHANGED (409): lần khoá mà kháng nghị nhắm tới đã kết thúc (shop đã được
  // mở khoá hoặc bị khoá lại một lần khác) nên không còn gì để chấp nhận.
  'APPEAL_NOT_ALLOWED',
  'APPEAL_ALREADY_SENT',
  'APPEAL_NOT_FOUND',
  'APPEAL_ALREADY_DECIDED',
  'APPEAL_TARGET_CHANGED',
  // Báo cáo vi phạm (Week11.md 5.1, D5). REPORT_TARGET_NOT_FOUND (404): đối tượng không tồn tại, không công khai với người báo, hoặc
  // (hội thoại) người báo không phải thành viên — MỘT mã cho cả ba ca để không lộ đối tượng có thật hay không. REPORT_OWN_CONTENT (409):
  // báo đánh giá của chính mình / shop hay sản phẩm của chính shop mình. REPORT_ALREADY_OPEN (409): người này đã có một báo cáo ĐANG MỞ
  // về đối tượng đó. REPORT_LIMIT_REACHED (429): quá số báo cáo cho phép trong 24 giờ. Phía Admin: REPORT_NOT_FOUND (404): báo cáo không
  // tồn tại / id sai dạng; REPORT_ALREADY_CLOSED (409): đã có Admin khác xử lý trước (gộp "sai trạng thái lúc đọc" và "thua race" như
  // SHOP_INVALID_TRANSITION); REPORT_ACTION_NOT_ALLOWED (409): hành động không dùng được cho loại báo cáo này (vd ẩn đánh giá cho báo
  // cáo shop, chặn người mua khi bên bị báo là chủ shop).
  'REPORT_ALREADY_OPEN',
  'REPORT_LIMIT_REACHED',
  'REPORT_TARGET_NOT_FOUND',
  'REPORT_OWN_CONTENT',
  'REPORT_NOT_FOUND',
  'REPORT_ALREADY_CLOSED',
  'REPORT_ACTION_NOT_ALLOWED',
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
  // NOT_ONLINE_PAYMENT: nhóm COD — không có cổng thanh toán để thử lại.
  PAYMENT_RETRY_NOT_ALLOWED: z.object({
    reason: z.enum(['ATTEMPT_PENDING', 'HOLD_EXPIRED', 'ALREADY_PAID', 'NOT_ONLINE_PAYMENT']),
  }),
  // PROCESSING_STARTED: shop đã xác nhận/đóng gói — không hủy ngay được, người mua gửi yêu cầu hủy
  // (Week9.md 1.3); IN_TRANSIT: đơn đã giao cho vận chuyển, không hủy được. Không còn PAID_ONLINE: đơn đã
  // trả online mà shop chưa xác nhận giờ hủy ngay được kèm hoàn tiền tự động (Week9.md 2.6/2.7).
  ORDER_CANCEL_NOT_ALLOWED: z.object({
    reason: z.enum(['PROCESSING_STARTED', 'IN_TRANSIT']),
  }),
  // Vì sao không gửi được yêu cầu hủy/trả hàng: NOT_ELIGIBLE_STATUS (đơn không ở CONFIRMED/PACKED/
  // COMPLETED), WINDOW_EXPIRED (quá cửa sổ trả hàng kể từ lúc COMPLETED), ALREADY_REQUESTED (đã có yêu cầu
  // cùng loại chưa rút), PAYMENT_NOT_COLLECTED (đơn online chưa có thanh toán thành công để hoàn).
  REFUND_REQUEST_NOT_ALLOWED: z.object({
    reason: z.enum([
      'NOT_ELIGIBLE_STATUS',
      'WINDOW_EXPIRED',
      'ALREADY_REQUESTED',
      'PAYMENT_NOT_COLLECTED',
    ]),
  }),
  // Vì sao không đánh giá được: ORDER_NOT_COMPLETED (đơn chưa COMPLETED), NOT_PURCHASED (đơn không chứa sản
  // phẩm đó), OWN_SHOP (sản phẩm của chính shop mình — kể cả đơn tự mua từ trước khi có luật chặn mua),
  // WINDOW_EXPIRED (quá REVIEW_WINDOW_DAYS kể từ lúc COMPLETED), ALREADY_REVIEWED (đã đánh giá sản phẩm này
  // trong đơn này).
  REVIEW_NOT_ALLOWED: z.object({
    reason: z.enum([
      'ORDER_NOT_COMPLETED',
      'NOT_PURCHASED',
      'OWN_SHOP',
      'WINDOW_EXPIRED',
      'ALREADY_REVIEWED',
    ]),
  }),
  // Trạng thái HIỆN TẠI của shop lúc bị từ chối sửa.
  SHOP_EDIT_NOT_ALLOWED: z.object({ status: shopStatusSchema }),
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
