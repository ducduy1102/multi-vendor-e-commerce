'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import {
  findMatchingVariant,
  isValueAvailable,
  type SelectedValues,
  type SelectorAttribute,
  type SelectorVariant,
} from './VariantSelector.utils';

interface VariantSelectorProps {
  attributes: SelectorAttribute[];
  variants: SelectorVariant[];
  onVariantChange: (variant: SelectorVariant | undefined) => void;
}

// Component thuần (Week5.md Bước 3.2) — tự giữ state lựa chọn bên trong,
// chỉ báo ra ngoài qua onVariantChange (variant khớp đủ combo, hoặc
// undefined nếu chưa chọn đủ/không khớp). Cha (ProductVariantSection) dùng
// callback này để đổi giá hiển thị theo 1.15 — không tự hiển thị giá ở đây,
// component này chỉ lo phần chọn thuộc tính.
export function VariantSelector({ attributes, variants, onVariantChange }: VariantSelectorProps) {
  const t = useTranslations('product');
  const [selectedValues, setSelectedValues] = useState<SelectedValues>({});

  useEffect(() => {
    onVariantChange(findMatchingVariant(variants, attributes, selectedValues));
    // onVariantChange cố ý không nằm trong deps — cha truyền hàm mới mỗi
    // render (setState từ useState luôn stable, nhưng để an toàn không giả
    // định điều đó ở cha), chỉ cần chạy lại khi chính lựa chọn đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, attributes, selectedValues]);

  if (attributes.length === 0) {
    return null;
  }

  function handleSelect(attributeName: string, value: string) {
    const isSelected = selectedValues[attributeName] === value;
    if (!isSelected && !isValueAvailable(variants, attributeName, value, selectedValues)) {
      return;
    }
    setSelectedValues((prev) => {
      const next = { ...prev };
      if (isSelected) {
        delete next[attributeName];
      } else {
        next[attributeName] = value;
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {attributes.map((attribute) => (
        <div key={attribute.id} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{attribute.name}</span>
          <div className="flex flex-wrap gap-2">
            {attribute.values.map((attributeValue) => {
              const isSelected = selectedValues[attribute.name] === attributeValue.value;
              const isAvailable =
                isSelected ||
                isValueAvailable(variants, attribute.name, attributeValue.value, selectedValues);

              return (
                <Button
                  key={attributeValue.id}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  disabled={!isAvailable}
                  aria-pressed={isSelected}
                  aria-label={
                    isAvailable ? undefined : `${attributeValue.value} — ${t('detailOutOfStock')}`
                  }
                  onClick={() => handleSelect(attribute.name, attributeValue.value)}
                  className={cn(!isAvailable && 'line-through')}
                >
                  {attributeValue.value}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
