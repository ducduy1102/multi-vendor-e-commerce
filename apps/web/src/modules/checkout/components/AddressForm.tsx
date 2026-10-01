'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { VIETNAM_PROVINCES } from '@ecommerce/types';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import {
  addressFormSchema,
  EMPTY_ADDRESS_FORM_VALUES,
  type AddressFormInput,
} from '../schemas/address.schema';

interface AddressFormProps {
  onSubmit: (values: AddressFormInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Native <select> (không thêm primitive Select của shadcn — chưa được duyệt, cùng quyết định
// đã chốt ở VoucherForm), style khớp Input để đồng bộ giao diện và focus-visible.
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

// Địa chỉ 2 cấp (Week7.md 1.8) — KHÔNG có ô Quận/Huyện (cấp huyện đã chấm dứt hoạt động từ
// 01/07/2025). Chỉ lo UI + validate, gọi API do component cha truyền onSubmit vào (giống
// VoucherForm/LoginForm). Mọi ô là chuỗi (input === output type, addressFormSchema không
// transform), province chuẩn hoá về tên chuẩn ở BE (createAddressSchema), không phải ở đây.
export function AddressForm({ onSubmit, isSubmitting = false }: AddressFormProps) {
  const t = useTranslations('checkout');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddressFormInput>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: EMPTY_ADDRESS_FORM_VALUES,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address-recipient-name">{t('recipientNameLabel')}</Label>
        <Input
          id="address-recipient-name"
          autoComplete="name"
          maxLength={100}
          aria-invalid={!!errors.recipientName}
          {...register('recipientName')}
        />
        {errors.recipientName && (
          <p className="text-sm text-destructive">{tv(errors.recipientName.message)}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address-phone">{t('phoneLabel')}</Label>
        <Input
          id="address-phone"
          type="tel"
          autoComplete="tel"
          aria-invalid={!!errors.phone}
          {...register('phone')}
        />
        {errors.phone && <p className="text-sm text-destructive">{tv(errors.phone.message)}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address-line1">{t('line1Label')}</Label>
        <Input
          id="address-line1"
          autoComplete="address-line1"
          maxLength={200}
          aria-invalid={!!errors.line1}
          {...register('line1')}
        />
        {errors.line1 && <p className="text-sm text-destructive">{tv(errors.line1.message)}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address-ward">{t('wardLabel')}</Label>
          <Input
            id="address-ward"
            maxLength={100}
            aria-invalid={!!errors.ward}
            {...register('ward')}
          />
          {errors.ward && <p className="text-sm text-destructive">{tv(errors.ward.message)}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address-province">{t('provinceLabel')}</Label>
          <select
            id="address-province"
            className={SELECT_CLASS}
            aria-invalid={!!errors.province}
            defaultValue=""
            {...register('province')}
          >
            <option value="" disabled>
              {t('provincePlaceholder')}
            </option>
            {VIETNAM_PROVINCES.map((province) => (
              <option key={province.code} value={province.name}>
                {province.name}
              </option>
            ))}
          </select>
          {errors.province && (
            <p className="text-sm text-destructive">{tv(errors.province.message)}</p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('addressFormSubmitting') : t('addressFormSubmit')}
      </Button>
    </form>
  );
}
