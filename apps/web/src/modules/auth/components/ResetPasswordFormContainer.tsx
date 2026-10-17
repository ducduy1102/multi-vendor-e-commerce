'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/shared/lib/api-client';
import { getErrorCode } from '@/shared/lib/error-codes';

import { me, resetPassword } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';
import type { ResetPasswordFormInput } from '../types';
import { ResetPasswordForm } from './ResetPasswordForm';
import { ResetPasswordLinkInvalid } from './ResetPasswordLinkInvalid';

interface ResetPasswordFormContainerProps {
  // Token đọc từ query param ?token= ở page.tsx (Server Component, prop `searchParams`) — `null` khi
  // thiếu/rỗng/không phải chuỗi (cùng cách VerifyEmailStatus). Đây là bí mật dùng một lần: không log,
  // không hiện lại ra giao diện, chỉ gửi lên BE đúng một lần ở lúc submit.
  token: string | null;
}

// Nối ResetPasswordForm (UI + validate) với service gọi API — đặt trong modules/ để
// app/reset-password/page.tsx chỉ compose (rules/frontend.md mục 1).
export function ResetPasswordFormContainer({ token }: ResetPasswordFormContainerProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BE từ chối token (sai/hết hạn/đã dùng/tài khoản không còn hoạt động — một mã chung RESET_TOKEN_INVALID):
  // form không còn ý nghĩa nên thay bằng thông báo + đường xin liên kết mới, thay vì để người dùng nhập lại
  // mật khẩu rồi nhận đúng lỗi đó lần nữa.
  const [isTokenRejected, setIsTokenRejected] = useState(false);

  if (!token) {
    return <ResetPasswordLinkInvalid message={t('resetPasswordMissingToken')} />;
  }
  if (isTokenRejected) {
    return <ResetPasswordLinkInvalid message={t('errorResetTokenInvalid')} />;
  }

  async function handleSubmit(values: ResetPasswordFormInput) {
    if (!token) return;
    setIsSubmitting(true);
    setError(null);
    try {
      // confirmPassword chỉ để validate ở FE — không gửi lên BE.
      await resetPassword({ token, newPassword: values.newPassword });
    } catch (err) {
      if (err instanceof ApiError && getErrorCode(err) === 'RESET_TOKEN_INVALID') {
        setIsTokenRejected(true);
      } else {
        // Không in `err.message` của BE (có thể là chuỗi tiếng Anh/khoá validate chưa dịch).
        setError(t('resetPasswordGenericError'));
      }
      setIsSubmitting(false);
      return;
    }

    // Người đang đăng nhập (điển hình: tài khoản chỉ có Google dùng chính luồng này để ĐẶT mật khẩu lần
    // đầu — Week9.md 1.11) vẫn giữ session cũ trong store với `hasPassword = false` đã cũ; không làm mới
    // thì /account/password hiện sai "Đặt mật khẩu" tới khi tải lại trang. Hỏi lại BE thay vì tự gán
    // `hasPassword: true`: người nhấn link có thể đang đăng nhập bằng TÀI KHOẢN KHÁC với tài khoản vừa
    // đặt lại. Lỗi ở đây (session hết hạn…) không làm hỏng việc đặt mật khẩu đã xong nên bỏ qua.
    if (useAuthStore.getState().user) {
      try {
        setUser(await me());
      } catch {
        // phiên cũ không còn dùng được — AuthHydrator/proxy.ts lo ở lần điều hướng/tải trang kế tiếp.
      }
    }

    toast.success(t('resetPasswordSuccess'));
    router.push('/login');
    setIsSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ResetPasswordForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
