// Tên hai cookie phiên đăng nhập (httpOnly). Nằm ở shared/ vì cả REST (modules/auth: đặt/xoá/đọc cookie) lẫn
// hạ tầng real-time (shared/realtime: đọc access_token ở handshake WebSocket) phải dùng ĐÚNG cùng một tên, mà
// shared/ không được import từ modules/ (module-boundaries.spec.ts). `modules/auth/auth.constants.ts` re-export
// lại hai hằng số này nên các nơi import cũ không đổi.
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
