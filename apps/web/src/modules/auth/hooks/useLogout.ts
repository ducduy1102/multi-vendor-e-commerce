'use client';

import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';

import { logout } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';

// Logic đăng xuất dùng chung giữa LogoutButton (DropdownMenuItem, dropdown
// tài khoản desktop) và AccountSheet (shared/components/AccountSheet.tsx,
// Sheet mobile) — 2 nơi cần render khác nhau (MenuItem vs Button thường)
// nhưng cùng 1 luồng gọi API/clear store/điều hướng, tránh lặp lại.
export function useLogout() {
  const router = useRouter();
  const clearUser = useAuthStore((state) => state.clearUser);
  const [isLoading, setIsLoading] = useState(false);

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

  return { handleLogout, isLoading };
}
