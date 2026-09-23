'use client';

import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useVariantSelection } from './VariantSelectionContext';
import { findGalleryVariant, type SelectorVariant } from './VariantSelector.utils';

interface ProductGalleryProps {
  variants: SelectorVariant[];
}

// Week5.md Bước 3.3 — đổi CẢ BỘ `variant.images[]` theo variant đang chọn
// (không còn giới hạn 1 ảnh/variant, đúng quyết định 1.3/2.12). Đọc
// `selectedValues` qua context chung với `VariantSelector`/`ProductVariantSection`
// (xem VariantSelectionContext.tsx) — variant dùng cho gallery tính bằng
// `findGalleryVariant` (khớp SUBSET lựa chọn, khác `findMatchingVariant` yêu
// cầu chọn đủ, đúng 1.15: đổi ảnh ngay khi mới chọn 1 phần thuộc tính).
export function ProductGallery({ variants }: ProductGalleryProps) {
  const { selectedValues } = useVariantSelection();
  const galleryVariant = findGalleryVariant(variants, selectedValues);

  // `key={galleryVariant?.id}` — đổi variant thì remount hẳn
  // GalleryImages (đúng pattern React khuyến nghị để "reset state khi 1
  // giá trị đổi": https://react.dev/learn/you-might-not-need-an-effect,
  // mục "Resetting all state when a prop changes"), tự đưa `activeIndex`
  // (thumbnail đang chọn) về 0 — không dùng useEffect + setState (bị
  // react-hooks/set-state-in-effect chặn, gây cascading render thừa).
  return <GalleryImages key={galleryVariant?.id ?? 'none'} images={galleryVariant?.images ?? []} />;
}

interface GalleryImagesProps {
  images: { url: string; position: number }[];
}

function GalleryImages({ images }: GalleryImagesProps) {
  const t = useTranslations('product');
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex] ?? images[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
        {activeImage ? (
          <Image
            src={activeImage.url}
            alt=""
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center" aria-hidden="true">
            <ImageOff className="size-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {images.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              aria-pressed={index === activeIndex}
              aria-label={t('detailThumbnailLabel', { index: index + 1 })}
              onClick={() => setActiveIndex(index)}
              className={cn(
                'relative size-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors',
                index === activeIndex ? 'border-primary' : 'border-transparent hover:border-border',
              )}
            >
              <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
