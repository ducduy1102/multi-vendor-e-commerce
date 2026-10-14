'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

interface ResetPasswordLinkInvalidProps {
  // Câu đã dịch sẵn — thiếu token trên URL và token bị BE từ chối là 2 nguyên nhân khác nhau nhưng cùng
  // một lối thoát (xin liên kết mới), nên chỉ khác nhau ở câu này.
  message: string;
}

// Trạng thái lỗi của trang /reset-password: liên kết hỏng/hết hạn/đã dùng — không còn gì để nhập, chỉ
// còn đường quay lại /forgot-password (Week9.md 6.1). Thuần trình bày; khai "use client" tường minh vì
// nơi duy nhất dùng là ResetPasswordFormContainer (Client Component) nên nó luôn bị bundle phía client
// (rules/frontend.md mục 2).
export function ResetPasswordLinkInvalid({ message }: ResetPasswordLinkInvalidProps) {
  const t = useTranslations('auth');

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button nativeButton={false} render={<Link href="/forgot-password" />}>
        {t('resetPasswordRequestNewLink')}
      </Button>
    </div>
  );
}
