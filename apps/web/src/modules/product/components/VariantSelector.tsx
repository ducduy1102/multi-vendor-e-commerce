'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useVariantSelection } from './VariantSelectionContext';
import {
  isValueAvailable,
  type SelectorAttribute,
  type SelectorVariant,
} from './VariantSelector.utils';

interface VariantSelectorProps {
  attributes: SelectorAttribute[];
  variants: SelectorVariant[];
}

// Component thuần (Week5.md Bước 3.2) — đọc/ghi `selectedValues` qua
// `useVariantSelection()` (Bước 3.3 — chuyển từ tự giữ state nội bộ +
// callback `onVariantChange` sang dùng chung Context với `ProductGallery`,
// xem lý do ở VariantSelectionContext.tsx) thay vì tự tính variant khớp rồi
// báo ra ngoài — nơi cần biết variant khớp (giá) hay variant gallery (ảnh)
// tự đọc `selectedValues` từ context và tự tính lấy bằng
// `findMatchingVariant`/`findGalleryVariant`, không còn qua callback.
export function VariantSelector({ attributes, variants }: VariantSelectorProps) {
  const t = useTranslations('product');
  const { selectedValues, select } = useVariantSelection();

  if (attributes.length === 0) {
    return null;
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
                  className={cn(!isAvailable && 'line-through')}
                  aria-pressed={isSelected}
                  aria-label={
                    isAvailable ? undefined : `${attributeValue.value} — ${t('detailOutOfStock')}`
                  }
                  onClick={() => select(attribute.name, attributeValue.value)}
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
