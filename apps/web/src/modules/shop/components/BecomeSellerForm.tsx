'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import { createShopSchema } from '../schemas/shop.schema';
import type { CreateShopInput } from '../types';

interface BecomeSellerFormProps {
  onSubmit: (values: CreateShopInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Chỉ lo UI + validate — gọi API (useCreateShop, Bước 3.7) do component cha
// truyền onSubmit vào, form không tự biết về hook/service (giống LoginForm).
// Không có field slug: BE tự sinh từ name (xem shop.service.ts createShop).
export function BecomeSellerForm({ onSubmit, isSubmitting }: BecomeSellerFormProps) {
  const t = useTranslations('shop');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateShopInput>({
    resolver: zodResolver(createShopSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="become-seller-name">{t('becomeSellerNameLabel')}</Label>
        <Input
          id="become-seller-name"
          type="text"
          aria-invalid={!!errors.name}
          {...register('name')}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="become-seller-description">{t('becomeSellerDescriptionLabel')}</Label>
        <Textarea
          id="become-seller-description"
          aria-invalid={!!errors.description}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="become-seller-logo-url">{t('becomeSellerLogoUrlLabel')}</Label>
        <Input
          id="become-seller-logo-url"
          type="text"
          placeholder="https://..."
          aria-invalid={!!errors.logoUrl}
          {...register('logoUrl')}
        />
        {errors.logoUrl && <p className="text-sm text-destructive">{errors.logoUrl.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="become-seller-banner-url">{t('becomeSellerBannerUrlLabel')}</Label>
        <Input
          id="become-seller-banner-url"
          type="text"
          placeholder="https://..."
          aria-invalid={!!errors.bannerUrl}
          {...register('bannerUrl')}
        />
        {errors.bannerUrl && <p className="text-sm text-destructive">{errors.bannerUrl.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? t('becomeSellerSubmitting') : t('becomeSellerSubmit')}
      </Button>
    </form>
  );
}
