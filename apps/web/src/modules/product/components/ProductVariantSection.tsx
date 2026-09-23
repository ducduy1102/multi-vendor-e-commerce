'use client';

import { useState } from 'react';

import { formatPrice } from '../format-price';
import { VariantSelector } from './VariantSelector';
import type { SelectorAttribute, SelectorVariant } from './VariantSelector.utils';

interface ProductVariantSectionProps {
  attributes: SelectorAttribute[];
  variants: SelectorVariant[];
  minPrice: string;
  maxPrice: string;
}

// Client Component giữ state `selectedVariant` — ProductDetailContainer
// (Server Component) không tự giữ được state nên tách ra đây, đúng ranh
// giới Server/Client (rules/frontend.md mục 2). Đổi giá theo lựa chọn (Week5.md
// Bước 1.15/3.2): khoảng minPrice-maxPrice khi chưa chọn đủ combo, giá cụ
// thể khi đã khớp đúng 1 variant. Gallery đổi ảnh theo variant (1.15 phần
// ảnh) để dành Bước 3.3 — chưa đụng tới ở đây.
export function ProductVariantSection({
  attributes,
  variants,
  minPrice,
  maxPrice,
}: ProductVariantSectionProps) {
  const [selectedVariant, setSelectedVariant] = useState<SelectorVariant | undefined>(undefined);

  const priceLabel = selectedVariant
    ? formatPrice(selectedVariant.price)
    : minPrice === maxPrice
      ? formatPrice(minPrice)
      : `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold text-foreground">{priceLabel}</p>
      <VariantSelector
        attributes={attributes}
        variants={variants}
        onVariantChange={setSelectedVariant}
      />
    </div>
  );
}
