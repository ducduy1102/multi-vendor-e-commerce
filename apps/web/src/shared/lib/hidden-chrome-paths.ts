// Trang đăng nhập/đăng ký tự có layout riêng (card giữa màn hình, không cần
// điều hướng) — dùng chung giữa Header (shared/components/Header.tsx) và
// BottomTabBar (shared/components/BottomTabBar.tsx) để 2 nơi không lệch
// danh sách route theo thời gian.
export const HIDDEN_CHROME_PATHS = ['/login', '/register'];
