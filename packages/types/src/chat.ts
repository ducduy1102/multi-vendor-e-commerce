import { z } from 'zod';
import { isSafeMessageText } from './text-safety';

// Chat người mua ↔ shop (Week10.md Bước 4). Ghi tin đi qua REST (idempotent bằng clientMessageId), socket chỉ
// ĐẨY kết quả — các schema dưới đây là hợp đồng của cả REST lẫn payload sự kiện, một nơi duy nhất cho BE và FE.

// Độ dài tối đa của một tin. PHẢI khớp CHECK `messages_content_length_in_range` ở DB (migration
// `extend_conversation_for_chat`): đổi ở đây thì phải đổi cả migration. Zod đếm đơn vị UTF-16 còn
// `char_length` của Postgres đếm ký tự, nên Zod luôn chặt hơn hoặc bằng.
export const CHAT_MESSAGE_MAX_LENGTH = 1000;
// Số tin mỗi trang khi tải lịch sử, và trần cho phép client xin.
export const CHAT_PAGE_SIZE = 30;
export const CHAT_MAX_PAGE_SIZE = 50;
// Số hội thoại mỗi trang ở danh sách.
export const CHAT_CONVERSATIONS_PAGE_SIZE = 20;
// Tin cuối hiện trong danh sách hội thoại bị rút gọn về chừng này ký tự (BE cắt, FE không phải cắt lại).
export const CHAT_PREVIEW_MAX_LENGTH = 100;

// Hai phía của một hội thoại. Chỉ BUYER mới mở được hội thoại; SHOP là chủ shop hiện tại (D6).
export const CHAT_ROLES = ['BUYER', 'SHOP'] as const;
export const chatRoleSchema = z.enum(CHAT_ROLES);
export type ChatRole = z.infer<typeof chatRoleSchema>;

// Nội dung một tin: văn bản thuần (D5) — không HTML, không tự tạo link. Thứ tự: chuẩn hoá xuống dòng
// (`\r\n`/`\r` → `\n`, vì client khác trình duyệt có thể gửi CRLF), cắt khoảng trắng hai đầu, rồi kiểm độ dài
// và ký tự. `isSafeMessageText` chỉ cho `\n` trong các ký tự điều khiển; NUL, bidi-override, BOM và dấu phân
// dòng Unicode bị chặn. KHÔNG chặn `<` `>`: "size < 5kg" hợp lệ, và React tự escape khi hiển thị.
export const chatMessageContentSchema = z
  .string({
    required_error: 'chat.validationMessageRequired',
    invalid_type_error: 'chat.validationMessageRequired',
  })
  .transform((value) => value.replace(/\r\n?/g, '\n'))
  .pipe(
    z
      .string()
      .trim()
      .min(1, 'chat.validationMessageRequired')
      .max(CHAT_MESSAGE_MAX_LENGTH, 'chat.validationMessageTooLong')
      .refine(isSafeMessageText, 'chat.validationMessageUnsafe'),
  );

// --- Request ----------------------------------------------------------------------------------------

// POST /conversations — người mua mở (hoặc lấy lại) hội thoại với một shop. Idempotent: gọi lại trả cùng một hội thoại.
export const openConversationSchema = z.object({ shopId: z.string().uuid() });
export type OpenConversationInput = z.infer<typeof openConversationSchema>;

// POST /conversations/:id/messages. `clientMessageId` do CLIENT sinh (crypto.randomUUID()) cho mỗi lần bấm gửi và
// dùng lại NGUYÊN khi thử lại: gửi lại cùng khoá trả đúng tin cũ thay vì tạo bản sao (D2). Bắt buộc ở API dù
// cột DB cho phép NULL, để mọi tin gửi qua giao diện đều an toàn khi thử lại.
export const sendMessageSchema = z.object({
  content: chatMessageContentSchema,
  clientMessageId: z.string().uuid(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// Phần người dùng thực sự điền ở ô nhập (không có clientMessageId — hook gửi tự sinh).
export const chatMessageFormSchema = sendMessageSchema.pick({ content: true });
export type ChatMessageFormInput = z.infer<typeof chatMessageFormSchema>;

// Con trỏ phân trang: chuỗi MỜ do BE sinh (base64url của mốc thời gian + id), client chỉ chuyển lại nguyên
// trạng. Schema chỉ giới hạn bộ ký tự và độ dài để chuỗi lạ bị loại sớm; BE tự giải mã và kiểm lại.
export const chatCursorSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

// Query param qua URL luôn là string — coerce number (rules/backend.md mục 2).
const pageLimitSchema = (defaultLimit: number) =>
  z.coerce.number().int().min(1).max(CHAT_MAX_PAGE_SIZE).default(defaultLimit);

// GET .../conversations/:id/messages — tin mới nhất trước; `before` là `nextCursor` của trang trước.
export const messageListQuerySchema = z.object({
  before: chatCursorSchema.optional(),
  limit: pageLimitSchema(CHAT_PAGE_SIZE),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

// GET .../conversations — hội thoại có tin mới nhất trước.
export const conversationListQuerySchema = z.object({
  before: chatCursorSchema.optional(),
  limit: pageLimitSchema(CHAT_CONVERSATIONS_PAGE_SIZE),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

// --- Response ---------------------------------------------------------------------------------------

const isoDateTimeSchema = z.string().datetime();

// Đối phương trong mắt người xem: người mua thấy shop (tên shop + logo), chủ shop thấy người mua. CHỈ tên hiển
// thị — không bao giờ email, SĐT hay địa chỉ (Week10.md, checklist bảo mật dữ liệu chat). Người dùng chưa có
// ảnh đại diện nên `logoUrl` của người mua luôn null.
export const chatCounterpartSchema = z.object({
  name: z.string(),
  logoUrl: z.string().nullable(),
});
export type ChatCounterpart = z.infer<typeof chatCounterpartSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderRole: chatRoleSchema,
  content: z.string(),
  createdAt: isoDateTimeSchema,
  // Chỉ để người gửi đối chiếu tin tạm (lạc quan) với tin thật; người nhận không cần.
  clientMessageId: z.string().uuid().nullish(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatLastMessageSchema = z.object({
  // Đã rút gọn về CHAT_PREVIEW_MAX_LENGTH ký tự.
  content: z.string(),
  senderRole: chatRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type ChatLastMessage = z.infer<typeof chatLastMessageSchema>;

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  counterpart: chatCounterpartSchema,
  // null = hội thoại vừa mở, chưa có tin nào (không xuất hiện trong danh sách, chỉ ở kết quả "mở hội thoại").
  lastMessage: chatLastMessageSchema.nullable(),
  lastMessageAt: isoDateTimeSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  // Mốc ĐỐI PHƯƠNG đã đọc tới (null = chưa đọc lần nào): tin của MÌNH có `createdAt <= otherLastReadAt` là đã được
  // xem — cho dấu "Đã xem". Đối phương gửi tin cũng nâng mốc của họ (trả lời là đã đọc). Cập nhật tức thời qua
  // `chat:read`, trường này giữ nó sau khi tải lại trang. Chỉ là mốc thời gian: không lộ thêm gì ngoài việc đối
  // phương đã mở hội thoại, đúng thứ `chat:read` đã đẩy.
  otherLastReadAt: isoDateTimeSchema.nullable(),
  // Shop không còn APPROVED (bị khoá/từ chối): hội thoại cũ chỉ đọc được, gửi tin trả CHAT_SHOP_UNAVAILABLE.
  isReadOnly: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListSchema = z.object({
  items: z.array(conversationSummarySchema),
  nextCursor: chatCursorSchema.nullable(),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

export const messageListSchema = z.object({
  items: z.array(chatMessageSchema),
  nextCursor: chatCursorSchema.nullable(),
});
export type MessageList = z.infer<typeof messageListSchema>;

// GET .../conversations/unread-count — tổng số tin chưa đọc cho huy hiệu. Mỗi vai có endpoint riêng nên mỗi
// vai nhận một con số (người dùng vừa là người mua vừa là chủ shop thấy hai huy hiệu khác nhau).
export const unreadCountSchema = z.object({ unreadCount: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

// POST .../conversations/:id/read — mốc "đã đọc tới" mới (chỉ tăng, không bao giờ lùi).
export const markReadResultSchema = z.object({ readAt: isoDateTimeSchema });
export type MarkReadResult = z.infer<typeof markReadResultSchema>;

// --- Payload sự kiện real-time ----------------------------------------------------------------------

// Sự kiện `chat:message` (REALTIME_EVENTS.chatMessage): gửi tới CẢ HAI phía, kể cả người vừa gửi (để các tab
// khác của họ đồng bộ). `viewerRole` là vai CỦA NGƯỜI NHẬN trong hội thoại đó — một người vừa là người mua vừa
// là chủ shop cần biết tin thuộc hộp thư nào; `shopId` để hộp thư của shop biết thuộc shop nào. Payload không
// chứa tên, email hay thông tin nào khác của đối phương (client tự tải lại danh sách nếu chưa biết hội thoại).
export const chatMessageEventSchema = z.object({
  message: chatMessageSchema,
  viewerRole: chatRoleSchema,
  shopId: z.string().uuid(),
});
export type ChatMessageEvent = z.infer<typeof chatMessageEventSchema>;
