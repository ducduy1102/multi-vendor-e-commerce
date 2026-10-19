import { z } from 'zod';

// Hợp đồng real-time giữa apps/api (Socket.io gateway) và apps/web (Week10.md Bước 3).

// Tên sự kiện. Một nơi duy nhất để hai phía không gõ lệch chuỗi.
export const REALTIME_EVENTS = {
  // server → client. Access token của kết nối sắp/đã hết hạn: server gửi sự kiện này rồi đóng kết nối. Client
  // phải gia hạn phiên (POST /auth/refresh) rồi kết nối lại — kết nối mới đọc lại cookie access_token mới.
  authExpired: 'auth:expired',
  // server → client. Tin nhắn mới trong một hội thoại mà người nhận là thành viên (cả hai phía, kể cả người
  // vừa gửi để đồng bộ các tab khác). Payload là tin nhắn — schema nằm cùng schema chat (Bước 4.2), vì nó là
  // chính thực thể tin nhắn chứ không phải một hình dạng riêng của kênh real-time.
  chatMessage: 'chat:message',
  // server → client. Đối phương đã xem hội thoại. Payload: chatReadPayloadSchema.
  chatRead: 'chat:read',
  // hai chiều: client báo "đang gõ" lên server, server chuyển tiếp cho đúng đối phương. Payload:
  // chatTypingPayloadSchema.
  chatTyping: 'chat:typing',
  // server → client. Thông báo mới. Payload là thông báo — schema nằm cùng schema notification (Bước 7.2).
  notificationNew: 'notification:new',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

// Lý do server từ chối kết nối, đi trong `connect_error.message` của socket.io-client. Client dựa vào đó để
// quyết định: MISSING_TOKEN/INVALID_TOKEN ⇒ thử gia hạn phiên một lần rồi nối lại; ACCOUNT_NOT_ACTIVE ⇒ dừng
// (phiên không còn hợp lệ); AUTH_UNAVAILABLE/TOO_MANY_ATTEMPTS ⇒ chờ rồi thử lại (lỗi phía server/bị giới hạn);
// FORBIDDEN_ORIGIN ⇒ lỗi cấu hình, không thử lại.
export const REALTIME_CONNECT_ERRORS = [
  'MISSING_TOKEN',
  'INVALID_TOKEN',
  'ACCOUNT_NOT_ACTIVE',
  'AUTH_UNAVAILABLE',
  'FORBIDDEN_ORIGIN',
  'TOO_MANY_ATTEMPTS',
] as const;
export type RealtimeConnectError = (typeof REALTIME_CONNECT_ERRORS)[number];

// Payload chỉ mang id và mốc thời gian: không nội dung tin nhắn, không tên, không email (Week10.md — checklist
// bảo mật dữ liệu chat). Mọi id là UUID để payload hỏng/lạ bị loại ngay ở biên.

// chat:typing — cả client → server lẫn server → client. Server luôn kiểm người gửi có thuộc hội thoại không
// rồi mới chuyển tiếp, và tự chọn người nhận (đối phương); client không chỉ định được người nhận.
export const chatTypingPayloadSchema = z.object({
  conversationId: z.string().uuid(),
});
export type ChatTypingPayload = z.infer<typeof chatTypingPayloadSchema>;

// chat:read — server → client, chỉ tới đúng đối phương của hội thoại. `readAt` là mốc "đã đọc tới" mới (ISO).
export const chatReadPayloadSchema = z.object({
  conversationId: z.string().uuid(),
  readAt: z.string().datetime(),
});
export type ChatReadPayload = z.infer<typeof chatReadPayloadSchema>;
