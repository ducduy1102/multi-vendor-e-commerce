'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { changePasswordFormSchema } from '../schemas/account.schema';
import type { ChangePasswordFormInput } from '../types';

interface ChangePasswordFormProps {
  onSubmit: (values: ChangePasswordFormInput) => void | Promise<void>;
  isSubmitting?: boolean;
  // Lỗi do BE trả về cho riêng ô "Mật khẩu hiện tại" (sai mật khẩu — BE là bên duy nhất biết) — hiện ngay
  // dưới ô đó thay vì một thông báo chung ở đầu form. Câu đã dịch sẵn, do Container truyền vào.
  currentPasswordError?: string | null;
}

// Chỉ lo UI + validate — gọi API do ChangePasswordFormContainer lo. Ô nhập lại mật khẩu chỉ ở FE, không gửi
// lên BE (Container lược trước khi gọi service).
export function ChangePasswordForm({
  onSubmit,
  isSubmitting = false,
  currentPasswordError,
}: ChangePasswordFormProps) {
  const t = useTranslations('account');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormInput>({
    resolver: zodResolver(changePasswordFormSchema),
  });

  const currentError = errors.currentPassword
    ? tv(errors.currentPassword.message)
    : (currentPasswordError ?? undefined);

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="change-password-current">{t('passwordCurrentLabel')}</Label>
        <Input
          id="change-password-current"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!currentError}
          aria-describedby={currentError ? 'change-password-current-error' : undefined}
          {...register('currentPassword')}
        />
        {currentError && (
          <p id="change-password-current-error" className="text-sm text-destructive">
            {currentError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="change-password-new">{t('passwordNewLabel')}</Label>
        <Input
          id="change-password-new"
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
        <Label htmlFor="change-password-confirm">{t('passwordConfirmLabel')}</Label>
        <Input
          id="change-password-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="text-sm text-destructive">{tv(errors.confirmPassword.message)}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('passwordSubmitting') : t('passwordSubmit')}
      </Button>
    </form>
  );
}
