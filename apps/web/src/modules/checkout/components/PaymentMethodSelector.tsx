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
  const hintId = useId();

  if (methods.length === 0) return null;

  return (
    <div
      role="radiogroup"
      aria-label={t('paymentMethodSectionTitle')}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold text-foreground">{t('paymentMethodSectionTitle')}</h3>
      {methods.map((method) => {
        // COD là cách gọi quen thuộc với người bán hơn người mua — thêm 1 dòng giải thích NGAY DƯỚI
        // dòng COD (không phải cuối nhóm), luôn hiện khi COD chọn được; phương thức bị khoá đã có
        // lý do ở bên phải nên không thêm gì. Cố ý không nói "tiền mặt": trả cho nhân viên giao hàng
        // có thể là chuyển khoản/quét mã, cùng cách các sàn lớn ghi.
        const hasCodHint = method.method === 'COD' && method.available;

        return (
          <div
            key={method.method}
            className={cn(
              'rounded-lg border border-border text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5',
              !method.available && 'opacity-60',
            )}
          >
            <label
              className={cn(
                'flex items-center justify-between gap-3 px-2.5 pt-2.5',
                // Có ghi chú bên dưới thì bớt đệm dưới để ghi chú bám sát dòng COD (không phải kéo đè lên).
                hasCodHint ? 'pb-1.5' : 'pb-2.5',
                method.available ? 'cursor-pointer' : 'cursor-not-allowed',
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
                  aria-describedby={hasCodHint ? hintId : undefined}
                />
                <span className="font-medium text-foreground">
                  {t(METHOD_LABEL_KEYS[method.method])}
                </span>
              </span>
              {!method.available && method.reason ? (
                <span className="text-xs text-muted-foreground">
                  {t(REASON_KEYS[method.reason])}
                </span>
              ) : null}
            </label>
            {hasCodHint ? (
              <p id={hintId} className="pr-2.5 pb-2.5 pl-8 text-xs text-muted-foreground">
                {t('paymentMethodCodHint')}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
