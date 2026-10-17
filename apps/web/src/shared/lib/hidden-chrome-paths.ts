// Trang đăng nhập/đăng ký/quên và đặt lại mật khẩu tự có layout riêng (card giữa màn hình, không cần
// điều hướng) — dùng chung giữa Header (shared/components/Header.tsx) và
// BottomTabBar (shared/components/BottomTabBar.tsx) để 2 nơi không lệch
// danh sách route theo thời gian.
//
// `/forgot-password` và `/reset-password` ẩn chrome như /login nhưng KHÔNG là route guest-only
// (shared/lib/auth-redirect.ts GUEST_ONLY_PATHS): người đang đăng nhập bằng Google dùng chính luồng này để
// đặt mật khẩu lần đầu (Week9.md 1.11).
export const HIDDEN_CHROME_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];
