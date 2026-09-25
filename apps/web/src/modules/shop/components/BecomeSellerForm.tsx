'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { createShopSchema } from '../schemas/shop.schema';
import type { CreateShopInput } from '../types';

interface BecomeSellerFormProps {
  onSubmit: (values: CreateShopInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Chỉ lo UI + validate — gọi API (useCreateShop, Bước 3.7) do component cha
// truyền onSubmit vào, form không tự biết về hook/service (giống LoginForm).
// Không có field slug: BE tự sinh từ name (xem shop.service.ts createShop).
// Field/FieldGroup/FieldError (không phải div/Label/<p> thủ công) — đúng
// convention skill shadcn cho form, cùng pattern UpdateShopForm.tsx.
export function BecomeSellerForm({ onSubmit, isSubmitting }: BecomeSellerFormProps) {
  const t = useTranslations('shop');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateShopInput>({
    resolver: zodResolver(createShopSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="become-seller-name">{t('becomeSellerNameLabel')}</FieldLabel>
          <Input
            id="become-seller-name"
            type="text"
            aria-invalid={!!errors.name}
            {...register('name')}
          />
          {errors.name && <FieldError>{tv(errors.name.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="become-seller-description">
            {t('becomeSellerDescriptionLabel')}
          </FieldLabel>
          <Textarea
            id="become-seller-description"
            aria-invalid={!!errors.description}
            {...register('description')}
          />
          {errors.description && <FieldError>{tv(errors.description.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.logoUrl}>
          <FieldLabel htmlFor="become-seller-logo-url">{t('becomeSellerLogoUrlLabel')}</FieldLabel>
          <Input
            id="become-seller-logo-url"
            type="text"
            placeholder="https://..."
            aria-invalid={!!errors.logoUrl}
            {...register('logoUrl')}
          />
          {errors.logoUrl && <FieldError>{tv(errors.logoUrl.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.bannerUrl}>
          <FieldLabel htmlFor="become-seller-banner-url">
            {t('becomeSellerBannerUrlLabel')}
          </FieldLabel>
          <Input
            id="become-seller-banner-url"
            type="text"
            placeholder="https://..."
            aria-invalid={!!errors.bannerUrl}
            {...register('bannerUrl')}
          />
          {errors.bannerUrl && <FieldError>{tv(errors.bannerUrl.message)}</FieldError>}
        </Field>

        <Button type="submit" disabled={isSubmitting} className="mt-2">
          {isSubmitting ? t('becomeSellerSubmitting') : t('becomeSellerSubmit')}
        </Button>
      </FieldGroup>
    </form>
  );
}
