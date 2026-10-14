'use client';

import { Store } from 'lucide-react';
import { useCallback, useState } from 'react';

import { cn } from '@/shared/lib/utils';

interface ShopPublicMediaProps {
  // Đã qua toSafeImageUrl (https hoặc null) ở nơi gọi.
  src: string | null;
}

// Banner và logo của trang shop công khai. URL do CHỦ SHOP tự nhập (bất kỳ host nào) nên KHÔNG dùng
// next/image: host chưa khai ở `images.remotePatterns` làm next/image ném lỗi và sập cả trang. Dùng <img>
// thường kèm `referrerPolicy="no-referrer"` (không gửi địa chỉ trang cho máy chủ ảnh lạ). Ảnh lỗi/thiếu ⇒
// khối thay thế có biểu tượng cửa hàng, không để icon ảnh vỡ của trình duyệt (Week9.md 1.10, 6.3). "use
// client" vì cần state `failedSrc` — phần còn lại của header vẫn là Server Component.
//
// Nhớ chính URL đã lỗi (không phải cờ bool) để đổi sang URL khác thì thử tải lại bình thường.
//
// Hai đường phát hiện ảnh lỗi: (1) `onError` — ảnh lỗi SAU khi hydrate; (2) ref callback kiểm
// `complete && naturalWidth === 0` — ảnh SSR lỗi RẤT NHANH, trước khi React gắn handler, nên sự kiện `error`
// đã phát ra và bị bỏ lỡ (đã gặp bằng Playwright: ảnh vỡ nằm lại, không có khối thay thế).
function useImageFallback(src: string | null) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.currentSrc !== '') {
        setFailedSrc(src);
      }
    },
    [src],
  );

  return {
    isShown: Boolean(src) && failedSrc !== src,
    imgRef,
    onError: () => setFailedSrc(src),
  };
}

export function ShopPublicBanner({ src }: ShopPublicMediaProps) {
  const { isShown, imgRef, onError } = useImageFallback(src);

  return (
    <div className="relative aspect-3/1 w-full overflow-hidden rounded-xl bg-muted sm:aspect-4/1">
      {isShown && src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL tuỳ ý của chủ shop, xem comment trên.
        <img
          ref={imgRef}
          src={src}
          // Ảnh trang trí — tên shop hiện ngay bên dưới.
          alt=""
          referrerPolicy="no-referrer"
          onError={onError}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center" aria-hidden="true">
          <Store className="size-10 text-muted-foreground/60" />
        </div>
      )}
    </div>
  );
}

export function ShopPublicLogo({ src }: ShopPublicMediaProps) {
  const { isShown, imgRef, onError } = useImageFallback(src);
  const frame = 'size-16 shrink-0 rounded-full border border-border bg-muted sm:size-20';

  return isShown && src ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL tuỳ ý của chủ shop, xem comment trên.
    <img
      ref={imgRef}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={onError}
      className={cn(frame, 'object-cover')}
    />
  ) : (
    <div className={cn(frame, 'flex items-center justify-center')} aria-hidden="true">
      <Store className="size-7 text-muted-foreground" />
    </div>
  );
}
