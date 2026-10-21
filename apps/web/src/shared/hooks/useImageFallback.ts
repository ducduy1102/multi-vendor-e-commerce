import { useCallback, useState } from 'react';

// Phát hiện ảnh lỗi để nơi dùng thay bằng khối dự phòng (không để icon ảnh vỡ của trình duyệt). Dùng cho ảnh có URL
// do người dùng/chủ shop tự nhập (bất kỳ host nào — không dùng được next/image), ở trang shop công khai và danh sách
// chat. Nhớ chính URL đã lỗi (không phải cờ bool) để đổi sang URL khác thì thử tải lại bình thường.
//
// Hai đường phát hiện ảnh lỗi: (1) `onError` — ảnh lỗi SAU khi hydrate; (2) ref callback kiểm
// `complete && naturalWidth === 0` — ảnh SSR lỗi RẤT NHANH, trước khi React gắn handler, nên sự kiện `error`
// đã phát ra và bị bỏ lỡ (đã gặp bằng Playwright: ảnh vỡ nằm lại, không có khối thay thế).
export function useImageFallback(src: string | null) {
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
