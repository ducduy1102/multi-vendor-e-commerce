'use client';

import { AddToCartButton } from '@/modules/cart';
import { formatPrice } from '../format-price';
import { useVariantSelection } from './VariantSelectionContext';
import { VariantSelector } from './VariantSelector';
import {
  findMatchingVariant,
  type SelectorAttribute,
  type SelectorVariant,
} from './VariantSelector.utils';

interface ProductVariantSectionProps {
  attributes: SelectorAttribute[];
  variants: SelectorVariant[];
  minPrice: string;
  maxPrice: string;
}

// Client Component — đọc `selectedValues` qua context chung với
// `ProductGallery` (Week5.md Bước 3.3, xem VariantSelectionContext.tsx).
// Đổi giá theo lựa chọn (1.15): khoảng minPrice-maxPrice khi chưa chọn đủ
// combo, giá cụ thể khi đã khớp đúng 1 variant.
export function ProductVariantSection({
  attributes,
  variants,
  minPrice,
  maxPrice,
}: ProductVariantSectionProps) {
  const { selectedValues } = useVariantSelection();
  const matchedVariant = findMatchingVariant(variants, attributes, selectedValues);

  const priceLabel = matchedVariant
    ? formatPrice(matchedVariant.price)
    : minPrice === maxPrice
      ? formatPrice(minPrice)
      : `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold text-foreground">{priceLabel}</p>
      <VariantSelector attributes={attributes} variants={variants} />
      {/* AddToCartButton import từ modules/cart qua barrel — component tự chứa
          như WishlistButton (rules/frontend.md mục 1); variant đang chọn
          truyền vào qua props (findMatchingVariant chỉ trả variant đang bật). */}
      <AddToCartButton
        productVariantId={matchedVariant?.id ?? null}
        stock={matchedVariant?.stock ?? 0}
      />
    </div>
  );
}
