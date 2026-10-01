'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { PaymentMethod, PaymentMethodAvailability } from '../types';

const METHOD_LABEL_KEYS: Record<PaymentMethod, string> = {
  VNPAY: 'paymentMethodVnpayLabel',
  MOMO: 'paymentMethodMomoLabel',
  COD: 'paymentMethodCodLabel',
};

const REASON_KEYS: Record<string, string> = {
  NOT_CONFIGURED: 'paymentMethodReasonNotConfigured',
  AMOUNT_TOO_SMALL: 'paymentMethodReasonAmountTooSmall',
  AMOUNT_TOO_LARGE: 'paymentMethodReasonAmountTooLarge',
};

interface PaymentMethodSelectorProps {
  methods: PaymentMethodAvailability[];
  // null khi chưa chọn phương thức nào.
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

// Danh sách phương thức thanh toán lấy từ `paymentMethods` của POST /checkout/preview
// (Week7.md 1.9/3.4) — chỉ cho chọn phương thức `available`, phương thức không khả dụng hiện lý
// do đã dịch, KHÔNG tự suy ra khả dụng ở FE. Native <input type="radio"> (chưa có primitive
// RadioGroup được duyệt), cùng pattern AddressRadioList.
export function PaymentMethodSelector({ methods, selected, onSelect }: PaymentMethodSelectorProps) {
  // Cast sang LooseTranslator (giống shared/lib/error-codes.ts) — METHOD_LABEL_KEYS/REASON_KEYS
  // tra key theo giá trị runtime (`method`/`reason` từ BE), TypeScript không suy được literal key
  // tĩnh cho next-intl từ 1 Record được index động.
  const t = useTranslations('checkout') as unknown as LooseTranslator;
  const name = useId();

  if (methods.length === 0) return null;

  return (
    <div
      role="radiogroup"
      aria-label={t('paymentMethodSectionTitle')}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold text-foreground">{t('paymentMethodSectionTitle')}</h3>
      {methods.map((method) => (
        <label
          key={method.method}
          className={cn(
            'flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5',
            !method.available && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="flex items-center gap-2.5">
            <input
              type="radio"
              name={name}
              value={method.method}
              disabled={!method.available}
              checked={selected === method.method}
              onChange={() => onSelect(method.method)}
            />
            <span className="font-medium text-foreground">
              {t(METHOD_LABEL_KEYS[method.method])}
            </span>
          </span>
          {!method.available && method.reason ? (
            <span className="text-xs text-muted-foreground">{t(REASON_KEYS[method.reason])}</span>
          ) : null}
        </label>
      ))}
    </div>
  );
}
