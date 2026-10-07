'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { updateShopSchema } from '../schemas/shop.schema';
import type { UpdateShopInput } from '../types';

interface UpdateShopFormProps {
  defaultValues: UpdateShopInput;
  onSubmit: (values: UpdateShopInput) => void | Promise<void>;
  isSubmitting?: boolean;
  // Khoá toàn bộ form (shop PENDING/SUSPENDED, Week8.md 3C): mọi ô disabled và KHÔNG có nút gửi — không ẩn
  // form để chủ shop vẫn thấy thông tin hiện tại. Lý do khoá do nơi dùng hiển thị (ShopEditLockedHint).
  isReadOnly?: boolean;
  // Id đoạn giải thích vì sao khoá, gắn `aria-describedby` cho từng ô khi isReadOnly.
  readOnlyHintId?: string;
  // 'resubmit' (shop bị từ chối): nút chính là "Lưu và gửi duyệt lại"; mặc định 'save' ("Lưu thay đổi").
  submitVariant?: 'save' | 'resubmit';
}

// Cùng field với BecomeSellerForm (Bước 3.6) nhưng tất cả optional (schema
// đã omit slug/status, xem Bước 2.2/2.5) và pre-fill giá trị hiện tại của
// shop qua `values` (không phải `defaultValues` của react-hook-form) — `values`
// tự đồng bộ lại form khi prop đổi (vd sau khi useMyShop() refetch xong), phù
// hợp dữ liệu tới bất đồng bộ hơn `defaultValues` (chỉ áp dụng lúc mount).
export function UpdateShopForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  isReadOnly = false,
  readOnlyHintId,
  submitVariant = 'save',
}: UpdateShopFormProps) {
  const t = useTranslations('shop');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateShopInput>({
    resolver: zodResolver(updateShopSchema),
    values: defaultValues,
  });
  const describedBy = isReadOnly ? readOnlyHintId : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="update-shop-name">{t('becomeSellerNameLabel')}</FieldLabel>
          <Input
            id="update-shop-name"
            type="text"
            disabled={isReadOnly}
            aria-describedby={describedBy}
            aria-invalid={!!errors.name}
            {...register('name')}
          />
          {errors.name && <FieldError>{tv(errors.name.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="update-shop-description">
            {t('becomeSellerDescriptionLabel')}
          </FieldLabel>
          <Textarea
            id="update-shop-description"
            disabled={isReadOnly}
            aria-describedby={describedBy}
            aria-invalid={!!errors.description}
            {...register('description')}
          />
          {errors.description && <FieldError>{tv(errors.description.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.logoUrl}>
          <FieldLabel htmlFor="update-shop-logo-url">{t('becomeSellerLogoUrlLabel')}</FieldLabel>
          <Input
            id="update-shop-logo-url"
            type="text"
            placeholder="https://..."
            disabled={isReadOnly}
            aria-describedby={describedBy}
            aria-invalid={!!errors.logoUrl}
            {...register('logoUrl')}
          />
          {errors.logoUrl && <FieldError>{tv(errors.logoUrl.message)}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.bannerUrl}>
          <FieldLabel htmlFor="update-shop-banner-url">
            {t('becomeSellerBannerUrlLabel')}
          </FieldLabel>
          <Input
            id="update-shop-banner-url"
            type="text"
            placeholder="https://..."
            disabled={isReadOnly}
            aria-describedby={describedBy}
            aria-invalid={!!errors.bannerUrl}
            {...register('bannerUrl')}
          />
          {errors.bannerUrl && <FieldError>{tv(errors.bannerUrl.message)}</FieldError>}
        </Field>

        {isReadOnly ? null : (
          <Button type="submit" disabled={isSubmitting} className="mt-2">
            {submitVariant === 'resubmit'
              ? isSubmitting
                ? t('resubmitShopSubmitting')
                : t('resubmitShopSubmit')
              : isSubmitting
                ? t('updateShopSubmitting')
                : t('updateShopSubmit')}
          </Button>
        )}
      </FieldGroup>
    </form>
  );
}
