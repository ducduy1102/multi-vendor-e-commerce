'use client';

import { useAuthStore } from '../store/auth.store';
import { CurrentUserBadge } from './CurrentUserBadge';
import { GuestAuthLinks } from './GuestAuthLinks';
import { LogoutButton } from './LogoutButton';

// Gộp CurrentUserBadge/LogoutButton (đã đăng nhập) và GuestAuthLinks (chưa
// đăng nhập) thành 1 khối duy nhất, chỉ hiện đúng 1 trong 2 trạng thái tại 1
// thời điểm — tránh vừa thấy "Chưa đăng nhập" vừa thấy nút Đăng nhập/Đăng ký
// (CurrentUserBadge tự render text kể cả lúc chưa đăng nhập nếu dùng riêng).
// Không viết unit test — cùng lý do các Container dùng useRouter() khác
// (LogoutButton/GuestAuthLinks bên trong gọi router/Link), dựa vào Playwright
// test tay (rules/frontend.md mục 8).
export function AuthStatusBar() {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <GuestAuthLinks />;
  }

  return (
    <div className="flex items-center gap-2">
      <CurrentUserBadge />
      <LogoutButton />
    </div>
  );
}
