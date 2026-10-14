'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

// Thay cho form đổi mật khẩu khi tài khoản chưa có mật khẩu (`hasPassword = false` — chỉ đăng nhập bằng
// Google). Không có "mật khẩu hiện tại" để xác minh nên không cho đổi trực tiếp: dẫn sang luồng quên mật
// khẩu, nơi chứng minh quyền sở hữu hộp thư bằng liên kết gửi qua email rồi đặt mật khẩu đầu tiên
// (Week9.md 1.11).
export function SetPasswordNotice() {
  const t = useTranslations('account');

  return (
    <div className="flex flex-col items-start gap-3">
      <h3 className="text-sm font-semibold text-foreground">{t('passwordSetTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t('passwordSetDescription')}</p>
      <Button nativeButton={false} render={<Link href="/forgot-password" />}>
        {t('passwordSetAction')}
      </Button>
    </div>
  );
}
