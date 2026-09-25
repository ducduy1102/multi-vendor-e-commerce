'use client';

import { MinusIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  // Tối đa theo tồn kho (Week6.md 1.10: chặn mềm cả ở UI).
  max: number;
  disabled?: boolean;
}

// UI thuần, dùng chung cho nút "Thêm vào giỏ hàng" và trang giỏ hàng: nút +/-
// dựng bằng Button có sẵn, không dùng thư viện stepper mới. Số lượng hiện ở
// <output> (aria-live) để trình đọc màn hình báo giá trị mới khi bấm.
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
}: QuantityStepperProps) {
  const t = useTranslations('cart');

  return (
    <div role="group" aria-label={t('quantityLabel')} className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('quantityDecrease')}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon />
      </Button>
      <output aria-live="polite" className="min-w-8 text-center text-sm font-medium tabular-nums">
        {value}
      </output>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('quantityIncrease')}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}
