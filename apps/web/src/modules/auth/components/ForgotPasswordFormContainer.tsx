'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

import { forgotPassword } from '../services/auth.service';
import type { ForgotPasswordInput } from '../types';
import { ForgotPasswordForm } from './ForgotPasswordForm';

// Nối ForgotPasswordForm (UI + validate) với service gọi API — đặt trong modules/ để
// app/forgot-password/page.tsx chỉ compose (rules/frontend.md mục 1).
//
// Sau khi gửi luôn hiện cùng MỘT thông báo trung tính ("nếu email này có tài khoản…") — BE trả phản hồi
// giống hệt cho email có/không có tài khoản, khoá, hay đang trong thời gian chờ gửi lại (Week9.md 1.11), và
// FE cũng không được tự lộ khác biệt đó. Mọi lỗi (mất mạng, 5xx…) dùng 1 câu chung, không in `err.message`
// của BE: endpoint này không có lỗi nghiệp vụ nào người dùng cần phân biệt.
export function ForgotPasswordFormContainer() {
  const t = useTranslations('auth');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Email vừa gửi yêu cầu — hiện lại trong thông báo để người dùng tự nhận ra gõ nhầm (thông báo trung
  // tính nên không còn cách nào khác biết), đây là chính chuỗi họ vừa nhập chứ không phải dữ liệu từ BE.
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(values: ForgotPasswordInput) {
    setIsSubmitting(true);
    setError(null);
    try {
      await forgotPassword(values);
      setSentTo(values.email);
    } catch {
      setError(t('forgotPasswordGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const backToLogin = (
    <p className="text-center text-sm">
      <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
        {t('forgotPasswordBackToLogin')}
      </Link>
    </p>
  );

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm break-words">
          {t('forgotPasswordSent', { email: sentTo })}
        </p>
        <Button type="button" variant="outline" onClick={() => setSentTo(null)}>
          {t('forgotPasswordUseOtherEmail')}
        </Button>
        {backToLogin}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('forgotPasswordDescription')}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ForgotPasswordForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      {backToLogin}
    </div>
  );
}
