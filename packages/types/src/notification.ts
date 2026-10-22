import { z } from 'zod';
import { orderActorTypeSchema } from './order-status';
import { refundRequestKindSchema } from './refund';
import { shopStatusSchema } from './shop';
import { isSafeMessageText, utf8ByteLength } from './text-safety';

// Thông báo trong ứng dụng (Week10.md Bước 7). BE ghi qua NotificationService SAU khi thao tác nghiệp vụ đã
// commit rồi đẩy `notification:new`; FE đọc danh sách qua REST. Các schema dưới đây là hợp đồng của cả hai phía,
// được kiểm ở BIÊN: lúc GHI (loại và dữ liệu phải hợp lệ, nếu không không lưu) và lúc ĐỌC (loại/dữ liệu lạ không
// làm hỏng cả danh sách mà rơi về một thông báo chung).

// --- Hằng số ----------------------------------------------------------------------------------------

// Độ dài tối đa của `type`. PHẢI khớp CHECK `notifications_type_length_in_range` ở DB (migration
// `add_notifications_table`): đổi ở đây thì phải đổi cả migration (`notification-schemas.spec.ts` đọc file migration
// và so cận trên, nên lệch là test đỏ).
export const NOTIFICATION_TYPE_MAX_LENGTH = 64;
// Kích thước tối đa của `data` tính bằng BYTE UTF-8 của JSON gọn (`JSON.stringify`). DB giữ lưới an toàn nới gấp đôi
// (CHECK `notifications_data_size_limit` = 2048 byte văn bản jsonb, vì jsonb::text chèn thêm dấu cách) nên Zod luôn
// chặt hơn hoặc bằng — không có chuyện Zod cho qua mà DB từ chối.
export const NOTIFICATION_DATA_MAX_BYTES = 1024;
// Nhãn (tên shop, tên sản phẩm) và lý do hiển thị trong thông báo là bản CẮT GỌN — đầy đủ nằm ở trang đích. Giới hạn
// theo đơn vị UTF-16 (độ dài chuỗi JS); với tối đa 3 byte mỗi đơn vị, mọi loại thông báo đều nằm gọn dưới
// NOTIFICATION_DATA_MAX_BYTES (loại nhiều nhất: 60 + 120 đơn vị chữ ≈ 540 byte + id và khoá).
export const NOTIFICATION_LABEL_MAX_LENGTH = 60;
export const NOTIFICATION_REASON_MAX_LENGTH = 120;

// Số thông báo mỗi trang và trần cho phép client xin.
export const NOTIFICATIONS_PAGE_SIZE = 20;
export const NOTIFICATIONS_MAX_PAGE_SIZE = 50;

// --- Loại thông báo ---------------------------------------------------------------------------------

// Danh sách đầy đủ và người nhận của từng loại xem bảng ở Week10.md 7.3. `type` là chuỗi (không phải enum Postgres)
// nên thêm loại mới không cần migration — nhưng PHẢI thêm cả ở đây lẫn ở `notificationContentSchema` (có kiểm tra
// kiểu lúc biên dịch bên dưới: thiếu một trong hai là lỗi build).
export const NOTIFICATION_TYPES = [
  'ORDER_NEW',
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_CANCELLED',
  'ORDER_COMPLETED',
  'REFUND_REQUEST_NEW',
  'REFUND_REQUEST_APPROVED',
  'REFUND_REQUEST_REJECTED',
  'REFUND_REQUEST_ESCALATED',
  'REFUND_REQUEST_DECIDED_BY_ADMIN',
  'REFUND_COMPLETED',
  'REVIEW_NEW',
  'REVIEW_REPLIED',
  'SHOP_STATUS_CHANGED',
  'ADMIN_SHOP_PENDING',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

// --- Chữ trong `data` -------------------------------------------------------------------------------

const idSchema = z.string().uuid();

// Một dòng chữ an toàn: dùng bộ chặn ký tự của tin nhắn (NUL/điều khiển/bidi-override/BOM/dấu phân dòng) rồi cấm
// thêm xuống dòng. KHÔNG chặn `<` `>`: lý do của người dùng có thể chứa chúng và React tự escape khi hiển thị — còn
// "không URL" nghĩa là KHÔNG CÓ TRƯỜNG URL nào trong `data` (đường dẫn luôn dựng ở FE từ mẫu cố định + id), không phải
// cấm chữ trông giống URL trong tên shop.
const isSafeLabel = (value: string) => isSafeMessageText(value) && !value.includes('\n');
const labelSchema = z.string().min(1).max(NOTIFICATION_LABEL_MAX_LENGTH).refine(isSafeLabel);
const reasonSchema = z.string().min(1).max(NOTIFICATION_REASON_MAX_LENGTH).refine(isSafeLabel);

// Ký tự điều khiển (trừ khoảng trắng, đã được gộp riêng) và ký tự giả mạo thứ tự chữ — cùng bộ với text-safety.
// eslint-disable-next-line no-control-regex
const UNSAFE_LABEL_CHARS = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u2028\\u2029]',
  'g',
);

// Biến một chuỗi người dùng nhập (tên, lý do — có thể nhiều dòng, dài, lẫn ký tự lạ) thành nhãn 1 dòng hợp lệ với
// `labelSchema`/`reasonSchema`: gộp mọi khoảng trắng thành một dấu cách, bỏ ký tự điều khiển/giả mạo, cắt về
// `maxLength` đơn vị rồi thêm "…" (không bao giờ cắt đôi một cặp thay thế UTF-16 — emoji). Trả chuỗi rỗng nếu không còn
// gì. Người gọi (bên ghi thông báo) dùng hàm này TRƯỚC khi đưa chữ vào `data`, để `notify` không thất bại chỉ vì
// một lý do dài hay có ký tự lạ.
export function clipNotificationLabel(value: string, maxLength: number): string {
  const single = value
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_LABEL_CHARS, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (single.length <= maxLength) return single;
  let cut = single.slice(0, maxLength - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// Như trên nhưng cho trường tuỳ chọn: rỗng/không có ⇒ `undefined` (bỏ hẳn khoá khỏi `data` thay vì ghi chuỗi rỗng).
export function clipOptionalNotificationLabel(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const clipped = clipNotificationLabel(value, maxLength);
  return clipped === '' ? undefined : clipped;
}

// --- Nội dung theo từng loại ------------------------------------------------------------------------

// Mỗi loại là một object `{ type, data }` với `data` CHỈ gồm id (UUID) và vài nhãn ngắn — không URL, không địa
// chỉ/SĐT/email, không nội dung tin nhắn (D10, checklist bảo mật Week10.md). `.strict()`: khoá lạ bị từ chối, nên
// không ai nhét thêm được một trường (vd `url`) vào thông báo.
const content = <T extends NotificationType, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), data: z.object(shape).strict() });

// Vai của NGƯỜI NHẬN đối với đơn/yêu cầu. Một người vừa là người mua vừa là chủ shop có thể nhận cả hai, và đường
// dẫn đích khác nhau (`/orders/:id` hay `/seller/orders/:id`) nên không suy ra được từ vai của người dùng — phải
// ghi theo phía mà thông báo được gửi tới. Chỉ có ở loại có nhiều hơn một phía nhận.
const orderAudienceSchema = z.enum(['BUYER', 'SELLER']);
const refundEscalationAudienceSchema = z.enum(['SELLER', 'ADMIN']);

// Hình dạng `{ type, data }` của MỘT thông báo hợp lệ, phân biệt theo `type` — nơi DUY NHẤT khai dữ liệu của từng
// loại. Là phần "loại đã biết" của schema đọc, và (kèm giới hạn kích thước) của schema ghi bên dưới.
export const notificationContentSchema = z.discriminatedUnion('type', [
  // Chủ shop: có đơn mới (COD vào PENDING, hoặc VNPay vừa thanh toán xong).
  content('ORDER_NEW', { orderId: idSchema }),
  // Người mua: shop xác nhận / đã giao cho vận chuyển.
  content('ORDER_CONFIRMED', { orderId: idSchema, shopName: labelSchema }),
  content('ORDER_SHIPPED', { orderId: idSchema, shopName: labelSchema }),
  // Người mua (đơn bị shop/hệ thống/Admin hủy) hoặc chủ shop (người mua hủy). `by` = ai hủy.
  content('ORDER_CANCELLED', {
    orderId: idSchema,
    audience: orderAudienceSchema,
    by: orderActorTypeSchema,
    shopName: labelSchema,
    reason: reasonSchema.optional(),
  }),
  // Người mua: hệ thống tự hoàn tất đơn sau thời hạn (người mua tự bấm "đã nhận" thì không cần báo lại).
  content('ORDER_COMPLETED', { orderId: idSchema, shopName: labelSchema }),
  // Chủ shop: người mua gửi yêu cầu hủy/trả hàng.
  content('REFUND_REQUEST_NEW', { orderId: idSchema, kind: refundRequestKindSchema }),
  // Người mua: yêu cầu được duyệt / bị từ chối (kèm lý do của shop hoặc Admin).
  content('REFUND_REQUEST_APPROVED', { orderId: idSchema, kind: refundRequestKindSchema }),
  content('REFUND_REQUEST_REJECTED', {
    orderId: idSchema,
    kind: refundRequestKindSchema,
    reason: reasonSchema.optional(),
  }),
  // Tất cả Admin và chủ shop: người mua khiếu nại lên Admin.
  content('REFUND_REQUEST_ESCALATED', {
    orderId: idSchema,
    kind: refundRequestKindSchema,
    audience: refundEscalationAudienceSchema,
  }),
  // Chủ shop: Admin đã quyết định một khiếu nại.
  content('REFUND_REQUEST_DECIDED_BY_ADMIN', {
    orderId: idSchema,
    kind: refundRequestKindSchema,
    outcome: z.enum(['APPROVED', 'REJECTED']),
  }),
  // Người mua: khoản hoàn tiền đã thành công.
  content('REFUND_COMPLETED', { orderId: idSchema }),
  // Chủ shop: có đánh giá mới. Người mua: shop đã trả lời đánh giá của mình.
  content('REVIEW_NEW', {
    productId: idSchema,
    productName: labelSchema,
    rating: z.number().int().min(1).max(5),
  }),
  content('REVIEW_REPLIED', {
    productId: idSchema,
    productName: labelSchema,
    shopName: labelSchema,
  }),
  // Chủ shop: Admin đổi trạng thái shop (kèm lý do nếu có). Tất cả Admin: có shop mới/nộp lại chờ duyệt.
  content('SHOP_STATUS_CHANGED', {
    shopId: idSchema,
    status: shopStatusSchema,
    reason: reasonSchema.optional(),
  }),
  content('ADMIN_SHOP_PENDING', { shopId: idSchema, shopName: labelSchema }),
]);
export type NotificationContent = z.infer<typeof notificationContentSchema>;
export type NotificationOfType<T extends NotificationType> = Extract<
  NotificationContent,
  { type: T }
>;
export type NotificationData<T extends NotificationType> = NotificationOfType<T>['data'];

// Kiểm tra LÚC BIÊN DỊCH: mọi phần tử của NOTIFICATION_TYPES có schema nội dung và ngược lại. Thêm loại ở một nơi mà
// quên nơi kia thì hai dòng dưới đây không còn gán được `true` ⇒ lỗi build (không phải lỗi chạy lúc người dùng gặp).
type MissingContentSchema = Exclude<NotificationType, NotificationContent['type']>;
type UnlistedContentSchema = Exclude<NotificationContent['type'], NotificationType>;
const _everyTypeHasContent: [MissingContentSchema] extends [never] ? true : never = true;
const _everyContentIsListed: [UnlistedContentSchema] extends [never] ? true : never = true;
void _everyTypeHasContent;
void _everyContentIsListed;

// Schema dùng LÚC GHI: nội dung hợp lệ VÀ `data` không quá NOTIFICATION_DATA_MAX_BYTES (đo trên JSON gọn). Là hàng
// rào chính; CHECK ở DB chỉ là lưới an toàn cuối.
export function isNotificationDataWithinLimit(data: unknown): boolean {
  return utf8ByteLength(JSON.stringify(data)) <= NOTIFICATION_DATA_MAX_BYTES;
}

export const notificationWriteSchema = notificationContentSchema.superRefine((value, ctx) => {
  if (!isNotificationDataWithinLimit(value.data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'notification.dataTooLarge',
      path: ['data'],
    });
  }
});

// --- Response ---------------------------------------------------------------------------------------

const isoDateTimeSchema = z.string().datetime();
const baseFields = {
  id: idSchema,
  // null = chưa đọc.
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
};

// Loại ĐÃ BIẾT: `{ id, readAt, createdAt }` hợp với nội dung theo từng loại. Intersection (không phải mở rộng từng
// phần tử) để chỉ có MỘT nơi khai danh sách loại; TypeScript vẫn thu hẹp theo `type` như một union phân biệt.
const knownNotificationSchema = z.object(baseFields).and(notificationContentSchema);

// Loại LẠ hoặc dữ liệu không khớp hình dạng đã biết (bản BE/FE lệch nhau, dữ liệu cũ, hàng bị sửa tay): thay vì làm
// hỏng cả danh sách, rơi về một thông báo chung — `type: 'UNKNOWN'`, `data` rỗng. Cố ý KHÔNG chuyển tiếp `data` lạ
// sang giao diện (không bao giờ hiển thị thứ chưa được kiểm).
export const UNKNOWN_NOTIFICATION_TYPE = 'UNKNOWN' as const;
const unknownNotificationSchema = z
  .object({
    ...baseFields,
    type: z.string().min(1).max(NOTIFICATION_TYPE_MAX_LENGTH),
    data: z.unknown(),
  })
  .transform((value) => ({
    id: value.id,
    readAt: value.readAt,
    createdAt: value.createdAt,
    type: UNKNOWN_NOTIFICATION_TYPE,
    data: {} as Record<string, never>,
  }));

export const notificationSchema = z.union([knownNotificationSchema, unknownNotificationSchema]);
export type Notification = z.infer<typeof notificationSchema>;
export type KnownNotification = z.infer<typeof knownNotificationSchema>;
export type UnknownNotification = z.infer<typeof unknownNotificationSchema>;

// Con trỏ phân trang: chuỗi MỜ do BE sinh, client chỉ chuyển lại nguyên trạng (cùng cách chatCursorSchema); schema
// chỉ giới hạn bộ ký tự và độ dài để chuỗi lạ bị loại sớm, BE tự giải mã và kiểm lại.
export const notificationCursorSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

// GET /notifications — mới nhất trước. Query param qua URL luôn là string (rules/backend.md mục 2): `unreadOnly`
// KHÔNG dùng z.coerce.boolean() vì nó coi chuỗi "false" là true (mọi chuỗi không rỗng đều truthy).
export const listNotificationsQuerySchema = z.object({
  cursor: notificationCursorSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATIONS_MAX_PAGE_SIZE)
    .default(NOTIFICATIONS_PAGE_SIZE),
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: notificationCursorSchema.nullable(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

// GET /notifications/unread-count — số chính xác (không trần) cho huy hiệu.
export const notificationUnreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;

// POST /notifications/:id/read — mốc đọc của thông báo (idempotent: đã đọc rồi thì trả đúng mốc cũ, không ghi đè).
export const markNotificationReadResultSchema = z.object({ readAt: isoDateTimeSchema });
export type MarkNotificationReadResult = z.infer<typeof markNotificationReadResultSchema>;

// POST /notifications/read-all — số thông báo vừa được đánh dấu (0 khi không còn gì chưa đọc: idempotent).
export const markAllNotificationsReadResultSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type MarkAllNotificationsReadResult = z.infer<typeof markAllNotificationsReadResultSchema>;

// --- Payload sự kiện real-time ----------------------------------------------------------------------

// Sự kiện `notification:new` (REALTIME_EVENTS.notificationNew) tới đúng MỘT người nhận: payload chính là thông
// báo vừa ghi (cùng hình dạng với một phần tử của danh sách, `readAt: null`). Không kèm số chưa đọc: huy hiệu
// được tải lại theo lô thay vì cộng tay, để không đếm đôi khi sự kiện và lần tải đến lệch thứ tự (bài học từ chat).
export const notificationNewEventSchema = notificationSchema;
export type NotificationNewEvent = Notification;
