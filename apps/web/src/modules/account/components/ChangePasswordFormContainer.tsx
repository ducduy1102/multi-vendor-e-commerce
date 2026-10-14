'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/modules/auth';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useChangePassword } from '../hooks/useChangePassword';
import type { ChangePasswordFormInput } from '../types';
import { AccountFormSkeleton } from './AccountFormSkeleton';
import { ChangePasswordForm } from './ChangePasswordForm';
import { SessionRequiredNotice } from './SessionRequiredNotice';
import { SetPasswordNotice } from './SetPasswordNotice';

// Nối ChangePasswordForm với POST /auth/change-password. `user.hasPassword` (BE tính, không phải hash)
// quyết định "đổi" hay "đặt" mật khẩu. Thành công ⇒ toast + form được mount lại (xoá sạch 3 ô); BE cấp lại
// cookie cho phiên hiện tại nên thiết bị này vẫn đăng nhập, FE không cần làm gì thêm.
export function ChangePasswordFormContainer() {
  const t = useTranslations('account');
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const changePassword = useChangePassword();
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Đổi `key` để mount lại form ⇒ xoá 3 ô mật khẩu sau khi đổi thành công (không giữ mật khẩu trong DOM).
  const [formKey, setFormKey] = useState(0);

  if (isHydrating) {
    return <AccountFormSkeleton fieldCount={3} />;
  }
  if (!user) {
    return <SessionRequiredNotice next="/account/password" />;
  }
  if (!user.hasPassword) {
    return (
      <section aria-labelledby="account-password-title" className="flex max-w-lg flex-col gap-4">
        <h2 id="account-password-title" className="text-base font-semibold text-foreground">
          {t('passwordTitle')}
        </h2>
        <SetPasswordNotice />
      </section>
    );
  }

  async function handleSubmit(values: ChangePasswordFormInput) {
    if (!user) return;
    setError(null);
    setCurrentPasswordError(null);
    try {
      // confirmPassword chỉ để validate ở FE — không gửi lên BE.
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success(t('passwordChanged'));
      setFormKey((key) => key + 1);
    } catch (err) {
      const code = err instanceof ApiError ? getErrorCode(err) : undefined;
      if (code === 'CURRENT_PASSWORD_INCORRECT') {
        setCurrentPasswordError(tGlobal(ERROR_CODE_MESSAGE_KEYS[code]));
      } else if (code === 'PASSWORD_NOT_SET') {
        // Store còn `hasPassword = true` cũ (vd tài khoản Google vừa bị đổi ở thiết bị khác) — BE là bên
        // biết đúng. Lật cờ để giao diện chuyển sang khối "Đặt mật khẩu" thay vì để người dùng kẹt ở form.
        setUser({ ...user, hasPassword: false });
      } else {
        // Không in `err.message` của BE (có thể là chuỗi tiếng Anh/khoá validate chưa dịch).
        setError(t('passwordGenericError'));
      }
    }
  }

  return (
    <section aria-labelledby="account-password-title" className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="account-password-title" className="text-base font-semibold text-foreground">
          {t('passwordTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('passwordDescription')}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ChangePasswordForm
        key={formKey}
        onSubmit={handleSubmit}
        isSubmitting={changePassword.isPending}
        currentPasswordError={currentPasswordError}
      />
    </section>
  );
}
