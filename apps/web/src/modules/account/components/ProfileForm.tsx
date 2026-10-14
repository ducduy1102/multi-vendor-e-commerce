'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { USER_LOCALES, USER_NAME_MAX_LENGTH } from '@ecommerce/types';
import { BadgeCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { ResendVerificationButton } from '@/modules/auth';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { profileFormSchema } from '../schemas/account.schema';
import type { ProfileFormInput } from '../types';

interface ProfileFormProps {
  // Email chỉ đọc: đổi email cần xác thực lại nên chưa làm (Week9.md 1.1) — hiện để người dùng biết tài
  // khoản nào đang đăng nhập và đã xác thực chưa.
  email: string;
  isEmailVerified: boolean;
  initialValues: ProfileFormInput;
  onSubmit: (values: ProfileFormInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Native <select> (không thêm primitive Select của shadcn — chưa được duyệt, cùng quyết định ở
// AddressForm/VoucherForm), style khớp Input để đồng bộ giao diện và focus-visible.
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

// Chỉ lo UI + validate — gọi API và ghi user vào store do ProfileFormContainer lo (form không biết gì về
// service/store). Dữ liệu điền sẵn đã có ngay lúc mount (Container chỉ render form khi user đã sẵn) nên
// dùng `defaultValues`, không cần `values` (rules/frontend.md mục 4 áp dụng cho dữ liệu tới bất đồng bộ).
export function ProfileForm({
  email,
  isEmailVerified,
  initialValues,
  onSubmit,
  isSubmitting = false,
}: ProfileFormProps) {
  const t = useTranslations('account');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormInput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: initialValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name">{t('profileNameLabel')}</Label>
        <Input
          id="profile-name"
          autoComplete="name"
          maxLength={USER_NAME_MAX_LENGTH}
          aria-invalid={!!errors.name}
          {...register('name')}
        />
        {errors.name && <p className="text-sm text-destructive">{tv(errors.name.message)}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="profile-email">{t('profileEmailLabel')}</Label>
          {isEmailVerified ? (
            <Badge variant="outline">
              <BadgeCheck aria-hidden="true" />
              {t('profileEmailVerified')}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('profileEmailUnverified')}</Badge>
          )}
        </div>
        <Input
          id="profile-email"
          type="email"
          value={email}
          readOnly
          aria-describedby="profile-email-hint"
          className="bg-muted/50 text-muted-foreground"
        />
        <p id="profile-email-hint" className="text-xs text-muted-foreground">
          {t('profileEmailHint')}
        </p>
        {!isEmailVerified && <ResendVerificationButton size="sm" />}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-locale">{t('profileLocaleLabel')}</Label>
        <select
          id="profile-locale"
          className={SELECT_CLASS}
          aria-invalid={!!errors.locale}
          aria-describedby="profile-locale-hint"
          {...register('locale')}
        >
          {USER_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {t(locale === 'vi' ? 'profileLocaleVi' : 'profileLocaleEn')}
            </option>
          ))}
        </select>
        <p id="profile-locale-hint" className="text-xs text-muted-foreground">
          {t('profileLocaleHint')}
        </p>
        {errors.locale && <p className="text-sm text-destructive">{tv(errors.locale.message)}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('profileSubmitting') : t('profileSubmit')}
      </Button>
    </form>
  );
}
