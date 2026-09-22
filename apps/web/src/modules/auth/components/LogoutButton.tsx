'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';

import { useLogout } from '../hooks/useLogout';
import { useAuthStore } from '../store/auth.store';

// Hàng "Đăng xuất" trong dropdown tài khoản (Header, shared/components/Header.tsx).
// Chỉ dùng được bên trong 1 DropdownMenu (MenuPrimitive.Item đòi hỏi Menu
// context) — AccountSheet (mobile) không dùng lại được component này, tự
// render Button thường nhưng gọi chung useLogout().
export function LogoutButton() {
  const t = useTranslations('auth');
  const user = useAuthStore((state) => state.user);
  const { handleLogout, isLoading } = useLogout();

  // Chỉ hiện khi đã đăng nhập — trước đây hiện luôn dù chưa có user, gây
  // hiểu nhầm (bấm vào sẽ chỉ nhận 401 vì /auth/logout cần JwtAuthGuard).
  if (!user) {
    return null;
  }

  return (
    <DropdownMenuItem variant="destructive" disabled={isLoading} onClick={handleLogout}>
      <LogOut />
      {isLoading ? t('logoutSubmitting') : t('logoutSubmit')}
    </DropdownMenuItem>
  );
}
