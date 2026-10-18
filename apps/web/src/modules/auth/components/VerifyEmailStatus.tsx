'use client';

import type { ErrorCode } from '@ecommerce/types';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { me, verifyEmail } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';
import { ResendVerificationButton } from './ResendVerificationButton';

// Lưu MÃ lỗi chứ không lưu chuỗi đã dịch: đổi ngôn ngữ giữa chừng thì chữ đổi theo, và không bao giờ hiện
// `message` của BE (message tiếng Anh cho log; các lỗi cũ còn là tiếng Việt cứng, ở `/en` sẽ lộ tiếng Việt).
type VerifyState =
  { status: 'loading' } | { status: 'success' } | { status: 'error'; code: ErrorCode | undefined };

interface VerifyEmailStatusProps {
  token: string | null;
}

export function VerifyEmailStatus({ token }: VerifyEmailStatusProps) {
  const t = useTranslations('auth');
  // Key của bảng mã lỗi là key ĐẦY ĐỦ kèm namespace (trải trên nhiều namespace) nên dịch bằng translator
  // global, cùng cách useDescribeShopError.
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const [state, setState] = useState<VerifyState>({ status: 'loading' });
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  // Token verify chỉ dùng được 1 lần — React StrictMode (dev) chạy effect 2
  // lần, nếu gọi verifyEmail() 2 lần thì lần 2 sẽ luôn báo lỗi "không hợp lệ"
  // dù lần 1 đã thành công. Ref này chặn gọi lại cho cùng 1 token.
  const requestedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || requestedTokenRef.current === token) {
      return;
    }
    requestedTokenRef.current = token;

    verifyEmail(token)
      .then(() => {
        setState({ status: 'success' });
        // `useAuthStore` là nguồn duy nhất của user hiện tại (đã hydrate TRƯỚC khi xác thực xong nên còn
        // `emailVerifiedAt: null`): hỏi lại `me()` để banner "chưa xác thực" mất ngay, kể cả khi bấm "Về trang
        // chủ" (điều hướng client-side không hydrate lại). Lỗi (vd chưa đăng nhập ⇒ 401) bỏ qua: việc xác
        // thực đã thành công, banner sẽ tự đúng ở lần tải trang sau.
        me()
          .then(setUser)
          .catch(() => {});
      })
      .catch((err: unknown) =>
        setState({
          status: 'error',
          code: err instanceof ApiError ? getErrorCode(err) : undefined,
        }),
      );
  }, [token, setUser]);

  if (!token) {
    return <p className="text-sm text-destructive">{t('verifyEmailMissingToken')}</p>;
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-foreground">{t('verifyEmailVerifying')}</p>;
  }

  if (state.status === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm">{t('verifyEmailSuccess')}</p>
        <Button nativeButton={false} render={<Link href={user ? '/' : '/login'} />}>
          {user ? t('verifyEmailBackHome') : t('verifyEmailLogin')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-destructive">
        {state.code ? tGlobal(ERROR_CODE_MESSAGE_KEYS[state.code]) : t('verifyEmailGenericError')}
      </p>
      {user ? (
        <ResendVerificationButton />
      ) : (
        <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
          {t('verifyEmailLoginToResend')}
        </Button>
      )}
    </div>
  );
}
