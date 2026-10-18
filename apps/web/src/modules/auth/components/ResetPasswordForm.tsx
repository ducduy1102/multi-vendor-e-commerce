'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useIsHydrated } from '@/shared/hooks/useIsHydrated';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { resetPasswordFormSchema } from '../schemas/auth.schema';
import type { ResetPasswordFormInput } from '../types';

interface ResetPasswordFormProps {
  onSubmit: (values: ResetPasswordFormInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Chỉ lo UI + validate — token lấy từ URL và gọi API do component cha (ResetPasswordFormContainer) lo,
// form không biết gì về token/service.
export function ResetPasswordForm({ onSubmit, isSubmitting }: ResetPasswordFormProps) {
  const t = useTranslations('auth');
  const tv = useValidationMessage();
  // Nút gửi bị khoá tới khi hydrate xong, và form khai method="post" làm lưới an toàn: bấm trước hydrate
  // thì trình duyệt tự gửi form theo kiểu GET và mật khẩu mới lên thẳng URL (Week10.md 2.2).
  const isHydrated = useIsHydrated();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
  });

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password-new">{t('resetPasswordNewPasswordLabel')}</Label>
        <Input
          id="reset-password-new"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.newPassword}
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p className="text-sm text-destructive">{tv(errors.newPassword.message)}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password-confirm">{t('resetPasswordConfirmPasswordLabel')}</Label>
        <Input
          id="reset-password-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="text-sm text-destructive">{tv(errors.confirmPassword.message)}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting || !isHydrated} className="mt-2">
        {isSubmitting ? t('resetPasswordSubmitting') : t('resetPasswordSubmit')}
      </Button>
    </form>
  );
}
