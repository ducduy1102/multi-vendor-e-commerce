'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useVariantSelection } from './VariantSelectionContext';
import { findGalleryVariant, type SelectorVariant } from './VariantSelector.utils';

interface ProductGalleryProps {
  variants: SelectorVariant[];
  productName: string;
}

interface GalleryImage {
  url: string;
  position: number;
}

// Gộp ảnh của MỌI variant active thành 1 dải thumbnail duy nhất (đúng UX
// Shopee/Lazada: thumbnail luôn đủ ảnh của cả sản phẩm, chọn màu chỉ nhảy
// ảnh chính tới ảnh của màu đó). Thứ tự = thứ tự variant, rồi `position`
// trong từng variant; trùng URL (nhiều variant dùng chung 1 ảnh) chỉ giữ
// lần đầu để không lặp thumbnail.
function collectGalleryImages(variants: SelectorVariant[]): GalleryImage[] {
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  for (const variant of variants) {
    if (!variant.isActive) continue;
    const sorted = [...variant.images].sort((a, b) => a.position - b.position);
    for (const image of sorted) {
      if (!seen.has(image.url)) {
        seen.add(image.url);
        images.push(image);
      }
    }
  }
  return images;
}

// Ảnh chính theo variant đang chọn (`findGalleryVariant` — khớp SUBSET lựa
// chọn, đổi ngay khi mới chọn 1 phần thuộc tính, xem VariantSelector.utils).
// Người dùng bấm thumbnail thì ghi nhớ kèm `variantId` tại thời điểm bấm:
// đổi variant khác thì lựa chọn thủ công cũ tự hết hiệu lực (id không còn
// khớp) và ảnh chính quay về ảnh đầu tiên của variant mới — suy ra lúc
// render, không dùng useEffect + setState (bị react-hooks/set-state-in-effect
// chặn, gây render thừa).
export function ProductGallery({ variants, productName }: ProductGalleryProps) {
  const { selectedValues } = useVariantSelection();
  const [picked, setPicked] = useState<{ variantId: string | null; url: string } | null>(null);

  const images = collectGalleryImages(variants);
  const galleryVariant = findGalleryVariant(variants, selectedValues);
  const galleryVariantId = galleryVariant?.id ?? null;
  const variantFirstUrl = [...(galleryVariant?.images ?? [])].sort(
    (a, b) => a.position - b.position,
  )[0]?.url;

  const pickedUrl = picked?.variantId === galleryVariantId ? picked.url : undefined;
  const activeUrl = pickedUrl ?? variantFirstUrl ?? images[0]?.url;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
        {activeUrl ? (
          <Image
            src={activeUrl}
            alt={productName}
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
        <ThumbnailStrip
          images={images}
          activeUrl={activeUrl}
          onSelect={(url) => setPicked({ variantId: galleryVariantId, url })}
        />
      ) : null}
    </div>
  );
}

interface ThumbnailStripProps {
  images: GalleryImage[];
  activeUrl: string | undefined;
  onSelect: (url: string) => void;
}

// 1 hàng thumbnail kéo/vuốt ngang (embla-carousel, dragFree) thay vì xuống
// dòng nhiều hàng khi sản phẩm có nhiều ảnh. Thumbnail đang active tự cuộn
// vào khung nhìn khi ảnh chính đổi (bấm thumbnail hoặc đổi màu). Nút bên
// trong vẫn là <button> thường nên bàn phím/screen reader dùng như cũ; embla
// tự chặn click sau khi kéo nên kéo không vô tình chọn nhầm ảnh.
function ThumbnailStrip({ images, activeUrl, onSelect }: ThumbnailStripProps) {
  const t = useTranslations('product');
  const [emblaRef, emblaApi] = useEmblaCarousel({ dragFree: true, containScroll: 'keepSnaps' });
  const activeIndex = images.findIndex((image) => image.url === activeUrl);

  useEffect(() => {
    if (emblaApi && activeIndex >= 0) {
      emblaApi.scrollTo(activeIndex);
    }
  }, [emblaApi, activeIndex]);

  return (
    <div ref={emblaRef} className="overflow-hidden">
      <div className="flex gap-2">
        {images.map((image, index) => (
          <button
            key={image.url}
            type="button"
            aria-pressed={image.url === activeUrl}
            aria-label={t('detailThumbnailLabel', { index: index + 1 })}
            onClick={() => onSelect(image.url)}
            className={cn(
              'relative size-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              image.url === activeUrl ? 'border-primary' : 'border-transparent hover:border-border',
            )}
          >
            <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
