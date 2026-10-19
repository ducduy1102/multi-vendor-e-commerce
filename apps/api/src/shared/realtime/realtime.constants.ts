// Hằng số của hạ tầng real-time (Week10.md 3.2). Không đọc ENV: mọi giá trị ở đây là chính sách bảo mật cố
// định, không phải cấu hình triển khai (thay đổi phải qua review, không qua biến môi trường).

// Tối đa số kết nối đồng thời của MỘT người dùng (nhiều tab/thiết bị). Vượt thì kết nối CŨ NHẤT bị ngắt —
// không từ chối kết nối mới, vì kết nối cũ có thể đã chết mà server chưa biết (mất mạng, ngủ máy) và từ chối
// mới sẽ khoá chính người dùng đó cho tới khi ping timeout.
export const REALTIME_MAX_SOCKETS_PER_USER = 5;

// Chờ gói CONNECT của namespace tối đa bao lâu sau khi đã mở kết nối; handshake treo không được giữ tài nguyên.
export const REALTIME_CONNECT_TIMEOUT_MS = 5_000;

// Socket chỉ nhận sự kiện nhỏ (vd báo "đang gõ"); mọi lệnh ghi đi qua REST (Week10.md D2). Gói lớn hơn mức
// này bị server ngắt kết nối.
export const REALTIME_MAX_HTTP_BUFFER_BYTES = 1_024;

// Giới hạn handshake thất bại theo IP: quá ngưỡng trong cửa sổ thì chặn tới hết cửa sổ.
export const REALTIME_FAILED_HANDSHAKE_MAX = 20;
export const REALTIME_FAILED_HANDSHAKE_WINDOW_MS = 60_000;
// Trần số IP theo dõi cùng lúc, để kẻ tấn công đổi IP liên tục không làm phình bộ nhớ.
export const REALTIME_FAILED_HANDSHAKE_MAX_TRACKED = 10_000;

// Phòng riêng của từng người dùng. Phòng chỉ do SERVER gán từ userId đã xác thực — client không có sự kiện
// nào để tự vào phòng, nên không thể nghe lén phòng người khác.
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

// Tuỳ chọn Socket.io dùng chung cho MỌI gateway của ứng dụng. Nest chỉ tạo MỘT server cho các gateway cùng cổng/
// namespace và lấy tuỳ chọn của gateway nào được quét TRƯỚC — các gateway còn lại bị bỏ qua tuỳ chọn. Vì thứ tự
// quét không phải thứ để dựa vào, mọi gateway phải khai đúng cùng hằng số này (có test giữ điều đó), để server
// luôn chỉ-websocket, gói nhỏ, timeout ngắn dù gateway nào đứng đầu.
export interface RealtimeGatewayOptions {
  transports: 'websocket'[];
  maxHttpBufferSize: number;
  connectTimeout: number;
  serveClient: boolean;
}
export const REALTIME_GATEWAY_OPTIONS: RealtimeGatewayOptions = {
  transports: ['websocket'],
  maxHttpBufferSize: REALTIME_MAX_HTTP_BUFFER_BYTES,
  connectTimeout: REALTIME_CONNECT_TIMEOUT_MS,
  serveClient: false,
};
