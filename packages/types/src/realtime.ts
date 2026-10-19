// Hợp đồng real-time giữa apps/api (Socket.io gateway) và apps/web (Week10.md Bước 3). Chỉ khai báo tên —
// payload của từng sự kiện (Zod) được thêm cùng bước dựng cổng phát sự kiện (3.3).

// Tên sự kiện server → client. Một nơi duy nhất để hai phía không gõ lệch chuỗi.
export const REALTIME_EVENTS = {
  // Access token của kết nối sắp/đã hết hạn: server gửi sự kiện này rồi đóng kết nối. Client phải gia hạn
  // phiên (POST /auth/refresh) rồi kết nối lại — kết nối mới đọc lại cookie access_token mới.
  authExpired: 'auth:expired',
} as const;

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
