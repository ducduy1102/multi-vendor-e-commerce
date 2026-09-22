'use client';

import { Store, UserPlus, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';

export interface SellerChannelLink {
  href: '/seller/products' | '/seller/onboarding';
  icon: LucideIcon;
  hasShop: boolean;
  label: string;
}

// Trích từ Header.tsx — lúc tách ra dùng chung với HomeBanner ("UI polish
// đợt 2" mục 5, banner "Bán hàng cùng Chốt"), đúng ngưỡng "hook dùng chung
// ≥ 2 module" (rules/general.md mục 1). HomeBanner đã bỏ banner đó ("UI
// polish đợt 2 lần 2" mục 2, trùng đích với nav "Kênh người bán" ở Header)
// nên hiện chỉ còn Header dùng — giữ nguyên ở shared/hooks/ (không inline
// lại) vì không nằm trong phạm vi đã duyệt của đợt sửa này. Khách chưa
// đăng nhập vẫn trỏ /seller/onboarding — proxy.ts (PROTECTED_PATH_PREFIXES)
// tự redirect sang /login, không cần hook tự check thêm. null chỉ còn xảy
// ra khi đã đăng nhập nhưng useMyShop() chưa resolve xong (tránh nhấp nháy
// sai link rồi đổi ngay sau).
//
// `label` tự tính sẵn ở đây (namespace 'header' cố định — cả Header.tsx lẫn
// AccountSheet.tsx đều dùng đúng 2 key này, không có nhu cầu khác biệt) —
// trước đó Header.tsx và AccountSheet.tsx mỗi nơi tự lặp lại y hệt đoạn
// `hasShop ? t('myProductsLink') : t('becomeSellerLink')`, dễ lệch nếu 1
// trong 2 nơi sửa mà quên chỗ còn lại.
export function useSellerChannelLink(): SellerChannelLink | null {
  const t = useTranslations('header');
  const user = useAuthStore((state) => state.user);
  const myShopQuery = useMyShop({ enabled: !!user });

  if (user && myShopQuery.data) {
    return { href: '/seller/products', icon: Store, hasShop: true, label: t('myProductsLink') };
  }
  if (!user || myShopQuery.isSuccess) {
    return {
      href: '/seller/onboarding',
      icon: UserPlus,
      hasShop: false,
      label: t('becomeSellerLink'),
    };
  }
  return null;
}
