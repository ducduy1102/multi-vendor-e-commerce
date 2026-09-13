'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import { updateShopSchema } from '../schemas/shop.schema';
import type { UpdateShopInput } from '../types';

interface UpdateShopFormProps {
  defaultValues: UpdateShopInput;
  onSubmit: (values: UpdateShopInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Cùng field với BecomeSellerForm (Bước 3.6) nhưng tất cả optional (schema
// đã omit slug/status, xem Bước 2.2/2.5) và pre-fill giá trị hiện tại của
// shop qua `values` (không phải `defaultValues` của react-hook-form) — `values`
// tự đồng bộ lại form khi prop đổi (vd sau khi useMyShop() refetch xong), phù
// hợp dữ liệu tới bất đồng bộ hơn `defaultValues` (chỉ áp dụng lúc mount).
export function UpdateShopForm({ defaultValues, onSubmit, isSubmitting }: UpdateShopFormProps) {
  const t = useTranslations('shop');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateShopInput>({
    resolver: zodResolver(updateShopSchema),
    values: defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="update-shop-name">{t('becomeSellerNameLabel')}</Label>
        <Input
          id="update-shop-name"
          type="text"
          aria-invalid={!!errors.name}
          {...register('name')}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="update-shop-description">{t('becomeSellerDescriptionLabel')}</Label>
        <Textarea
          id="update-shop-description"
          aria-invalid={!!errors.description}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="update-shop-logo-url">{t('becomeSellerLogoUrlLabel')}</Label>
        <Input
          id="update-shop-logo-url"
          type="text"
          placeholder="https://..."
          aria-invalid={!!errors.logoUrl}
          {...register('logoUrl')}
        />
        {errors.logoUrl && <p className="text-sm text-destructive">{errors.logoUrl.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="update-shop-banner-url">{t('becomeSellerBannerUrlLabel')}</Label>
        <Input
          id="update-shop-banner-url"
          type="text"
          placeholder="https://..."
          aria-invalid={!!errors.bannerUrl}
          {...register('bannerUrl')}
        />
        {errors.bannerUrl && <p className="text-sm text-destructive">{errors.bannerUrl.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? t('updateShopSubmitting') : t('updateShopSubmit')}
      </Button>
    </form>
  );
}
