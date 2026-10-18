'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useIsHydrated } from '@/shared/hooks/useIsHydrated';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { forgotPasswordSchema } from '../schemas/auth.schema';
import type { ForgotPasswordInput } from '../types';

interface ForgotPasswordFormProps {
  onSubmit: (values: ForgotPasswordInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Chỉ lo UI + validate — gọi API do component cha truyền onSubmit vào (ForgotPasswordFormContainer).
export function ForgotPasswordForm({ onSubmit, isSubmitting }: ForgotPasswordFormProps) {
  const t = useTranslations('auth');
  const tv = useValidationMessage();
  // Nút gửi bị khoá tới khi hydrate xong, và form khai method="post" làm lưới an toàn: bấm trước hydrate
  // thì trình duyệt tự gửi form theo kiểu GET và email lên thẳng URL (Week10.md 2.2).
  const isHydrated = useIsHydrated();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-password-email">{t('forgotPasswordEmailLabel')}</Label>
        <Input
          id="forgot-password-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register('email')}
        />
        {errors.email && <p className="text-sm text-destructive">{tv(errors.email.message)}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting || !isHydrated} className="mt-2">
        {isSubmitting ? t('forgotPasswordSubmitting') : t('forgotPasswordSubmit')}
      </Button>
    </form>
  );
}
