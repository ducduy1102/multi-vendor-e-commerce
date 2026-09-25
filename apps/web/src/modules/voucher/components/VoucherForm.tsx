'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import {
  EMPTY_VOUCHER_FORM_VALUES,
  voucherFormSchema,
  type VoucherFormValues,
} from '../schemas/voucher.schema';

interface VoucherFormProps {
  onSubmit: (values: VoucherFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Native <select> (không thêm primitive Select của shadcn — chưa được duyệt),
// style khớp Input để đồng bộ giao diện và focus-visible.
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

// Chỉ lo UI + validate — gọi API do component cha truyền onSubmit vào (giống
// LoginForm). Mọi ô là chuỗi (input === output type, xem voucher.schema.ts);
// việc đổi sang số/ISO làm ở toCreateVoucherInput ngay trước khi gửi.
export function VoucherForm({ onSubmit, isSubmitting = false }: VoucherFormProps) {
  const t = useTranslations('voucher');
  const tv = useValidationMessage();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VoucherFormValues>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: EMPTY_VOUCHER_FORM_VALUES,
  });
  // useWatch (không phải watch) — tương thích React Compiler, chỉ render lại
  // khi đúng ô này đổi.
  const type = useWatch({ control, name: 'type' });
  const isPercent = type === 'PERCENT';

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-code">{t('codeLabel')}</Label>
          <Input
            id="voucher-code"
            autoComplete="off"
            maxLength={32}
            aria-invalid={!!errors.code}
            aria-describedby="voucher-code-hint"
            {...register('code')}
          />
          <p id="voucher-code-hint" className="text-xs text-muted-foreground">
            {t('codeHint')}
          </p>
          {errors.code && <p className="text-sm text-destructive">{tv(errors.code.message)}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-type">{t('typeLabel')}</Label>
          <select id="voucher-type" className={SELECT_CLASS} {...register('type')}>
            <option value="PERCENT">{t('typePercent')}</option>
            <option value="FIXED">{t('typeFixed')}</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-value">
            {isPercent ? t('valuePercentLabel') : t('valueFixedLabel')}
          </Label>
          <Input
            id="voucher-value"
            type="number"
            inputMode="decimal"
            min={0}
            aria-invalid={!!errors.value}
            {...register('value')}
          />
          {errors.value && <p className="text-sm text-destructive">{tv(errors.value.message)}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-min-order">{t('minOrderLabel')}</Label>
          <Input
            id="voucher-min-order"
            type="number"
            inputMode="numeric"
            min={0}
            aria-invalid={!!errors.minOrderAmount}
            {...register('minOrderAmount')}
          />
          {errors.minOrderAmount && (
            <p className="text-sm text-destructive">{tv(errors.minOrderAmount.message)}</p>
          )}
        </div>

        {isPercent ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="voucher-max-discount">{t('maxDiscountLabel')}</Label>
            <Input
              id="voucher-max-discount"
              type="number"
              inputMode="numeric"
              min={0}
              aria-invalid={!!errors.maxDiscountAmount}
              {...register('maxDiscountAmount')}
            />
            {errors.maxDiscountAmount && (
              <p className="text-sm text-destructive">{tv(errors.maxDiscountAmount.message)}</p>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-usage-limit">{t('usageLimitLabel')}</Label>
          <Input
            id="voucher-usage-limit"
            type="number"
            inputMode="numeric"
            min={1}
            aria-invalid={!!errors.usageLimit}
            {...register('usageLimit')}
          />
          {errors.usageLimit && (
            <p className="text-sm text-destructive">{tv(errors.usageLimit.message)}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-per-user-limit">{t('perUserLimitLabel')}</Label>
          <Input
            id="voucher-per-user-limit"
            type="number"
            inputMode="numeric"
            min={1}
            aria-invalid={!!errors.perUserLimit}
            {...register('perUserLimit')}
          />
          {errors.perUserLimit && (
            <p className="text-sm text-destructive">{tv(errors.perUserLimit.message)}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voucher-expires-at">{t('expiresAtLabel')}</Label>
          <Input
            id="voucher-expires-at"
            type="datetime-local"
            aria-invalid={!!errors.expiresAt}
            {...register('expiresAt')}
          />
          {errors.expiresAt && (
            <p className="text-sm text-destructive">{tv(errors.expiresAt.message)}</p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
