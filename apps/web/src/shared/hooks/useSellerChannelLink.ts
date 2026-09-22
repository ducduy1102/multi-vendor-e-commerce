'use client';

import { Store, UserPlus, type LucideIcon } from 'lucide-react';

import { useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';

export interface SellerChannelLink {
  href: '/seller/products' | '/seller/onboarding';
  icon: LucideIcon;
  hasShop: boolean;
}

// Trích từ Header.tsx (dùng lại ở HomeBanner — Bước "UI polish đợt 2" mục 5,
// banner "Bán hàng cùng Chốt") — đúng ngưỡng "hook dùng chung ≥ 2 module"
// (rules/general.md mục 1), đặt ở shared/hooks/ thay vì lặp lại ternary này
// ở 2 nơi rồi lệch nhau. Khách chưa đăng nhập vẫn trỏ /seller/onboarding —
// proxy.ts (PROTECTED_PATH_PREFIXES) tự redirect sang /login, không cần
// hook tự check thêm. null chỉ còn xảy ra khi đã đăng nhập nhưng
// useMyShop() chưa resolve xong (tránh nhấp nháy sai link rồi đổi ngay sau).
export function useSellerChannelLink(): SellerChannelLink | null {
  const user = useAuthStore((state) => state.user);
  const myShopQuery = useMyShop({ enabled: !!user });

  if (user && myShopQuery.data) {
    return { href: '/seller/products', icon: Store, hasShop: true };
  }
  if (!user || myShopQuery.isSuccess) {
    return { href: '/seller/onboarding', icon: UserPlus, hasShop: false };
  }
  return null;
}
