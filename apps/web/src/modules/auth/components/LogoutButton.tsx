'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';

import { logout } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';

// Hàng "Đăng xuất" trong dropdown tài khoản (Header, shared/components/Header.tsx).
export function LogoutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const clearUser = useAuthStore((state) => state.clearUser);
  const [isLoading, setIsLoading] = useState(false);

  // Chỉ hiện khi đã đăng nhập — trước đây hiện luôn dù chưa có user, gây
  // hiểu nhầm (bấm vào sẽ chỉ nhận 401 vì /auth/logout cần JwtAuthGuard).
  if (!user) {
    return null;
  }

  async function handleLogout() {
    setIsLoading(true);
    try {
      await logout();
    } finally {
      clearUser();
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <DropdownMenuItem variant="destructive" disabled={isLoading} onClick={handleLogout}>
      <LogOut />
      {isLoading ? t('logoutSubmitting') : t('logoutSubmit')}
    </DropdownMenuItem>
  );
}
