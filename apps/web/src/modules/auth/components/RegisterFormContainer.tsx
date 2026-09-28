'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { FieldSeparator } from '@/shared/components/ui/field';
import { ApiError } from '@/shared/lib/api-client';
import { useApiErrorMessage } from '@/shared/hooks/useValidationMessage';

import { register } from '../services/auth.service';
import type { RegisterFormInput } from '../types';
import { GoogleLoginButton } from './GoogleLoginButton';
import { RegisterForm } from './RegisterForm';

interface RegisterFormContainerProps {
  // Đích quay lại sau khi đăng nhập (Week7.md 1.2/3.2) — page.tsx đã kiểm
  // bằng safeNextPath trước khi truyền xuống, giữ nguyên khi chuyển sang
  // /login (sau khi đăng ký xong hoặc qua link "Đã có tài khoản?") và gắn
  // vào nút Google.
  next?: string;
}

// Nối RegisterForm (UI + validate, Bước 3.3) với service gọi API (Bước 3.5)
// — đặt trong modules/ để app/register/page.tsx chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1). Đăng ký xong KHÔNG tự login
// (BE cũng không issue token ở /register) — điều hướng sang /login để người
// dùng tự đăng nhập.
export function RegisterFormContainer({ next }: RegisterFormContainerProps) {
  const t = useTranslations('auth');
  const tApi = useApiErrorMessage();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginHref = next ? { pathname: '/login' as const, query: { next } } : '/login';

  async function handleSubmit(values: RegisterFormInput) {
    setIsSubmitting(true);
    setError(null);
    try {
      // confirmPassword chỉ để validate ở FE (Bước 3.2) — không gửi lên BE.
      await register({
        email: values.email,
        password: values.password,
        name: values.name,
      });
      router.push(loginHref);
    } catch (err) {
      setError(err instanceof ApiError ? tApi(err.message) : t('registerGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <RegisterForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      <FieldSeparator>{tCommon('or')}</FieldSeparator>
      <GoogleLoginButton label={t('registerGoogleSignIn')} next={next} />
      <p className="text-center text-sm text-muted-foreground">
        {t('registerHasAccountPrompt')}{' '}
        <Link
          href={loginHref}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('registerLoginLink')}
        </Link>
      </p>
    </div>
  );
}
