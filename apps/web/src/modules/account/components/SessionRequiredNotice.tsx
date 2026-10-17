'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

// Trang /account/* chỉ vào được khi có cookie (proxy.ts chặn guest), nhưng cookie có thể đã hết hạn/bị thu
// hồi: lúc đó AuthHydrator hỏi /auth/me ra 401 và store không có user. Thay vì để trang trống, báo rõ và
// dẫn tới đăng nhập (kèm `next` để quay lại đúng trang này sau đó — chỉ các trang account đã nằm trong
// danh sách `next` an toàn của packages/types).
export function SessionRequiredNotice({ next }: { next: string }) {
  const t = useTranslations('account');

  return (
    <div className="flex max-w-lg flex-col items-start gap-3">
      <p role="alert" className="text-sm text-muted-foreground">
        {t('sessionRequired')}
      </p>
      <Button nativeButton={false} render={<Link href={{ pathname: '/login', query: { next } }} />}>
        {t('sessionRequiredLogin')}
      </Button>
    </div>
  );
}
