'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';
import { useAuthStore } from '../store/auth.store';
import { ResendVerificationButton } from './ResendVerificationButton';

// Nhắc feature-level, KHÔNG chặn truy cập — email chưa xác thực vẫn cho
// login/browse bình thường (xem auth-shop-status-architecture.md). Hiện gắn
// dạng banner toàn app (trong app/layout.tsx) vì hiện chưa có feature nào
// thật sự chặn hành động (EmailVerifiedGuard chưa gắn route nào — BE Bước
// 2.10, checkout/tạo shop chưa tồn tại); sẽ cân nhắc gắn theo action cụ thể
// khi các feature đó ra đời.
export function EmailVerificationBanner() {
  const t = useTranslations('auth');
  const user = useAuthStore((state) => state.user);

  if (!user || user.emailVerifiedAt) {
    return null;
  }

  return (
    <Alert
      variant="warning"
      className="flex flex-wrap items-center justify-center gap-3 rounded-none border-x-0 border-t-0"
    >
      <span>{t('emailVerificationBannerMessage')}</span>
      <ResendVerificationButton size="sm" />
    </Alert>
  );
}
