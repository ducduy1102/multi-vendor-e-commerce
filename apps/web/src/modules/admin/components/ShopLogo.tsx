'use client';

import { Store } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_LOGO_CLASS } from './admin-shop-row.constants';

interface ShopLogoProps {
  src: string | null;
}

// Logo shop trong bảng duyệt. `logoUrl` do CHỦ SHOP tự nhập (bất kỳ URL nào, không chỉ Cloudinary —
// createShopSchema chỉ kiểm là URL hợp lệ) nên KHÔNG dùng next/image: host lạ chưa khai ở
// `images.remotePatterns` sẽ làm next/image ném lỗi và sập cả trang duyệt. Dùng <img> thường kèm
// `referrerPolicy="no-referrer"` (không gửi địa chỉ trang quản trị cho máy chủ ảnh lạ). Ảnh lỗi/thiếu
// ⇒ biểu tượng cửa hàng, không để icon ảnh vỡ của trình duyệt.
export function ShopLogo({ src }: ShopLogoProps) {
  // Nhớ chính URL đã lỗi (không phải cờ bool) để đổi sang URL khác thì thử tải lại bình thường.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        className={cn(ADMIN_SHOP_LOGO_CLASS, 'flex items-center justify-center bg-muted')}
        aria-hidden="true"
      >
        <Store className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL tuỳ ý của chủ shop, xem comment trên.
    <img
      src={src}
      // Ảnh thuần trang trí — tên shop hiện ngay bên cạnh.
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={cn(ADMIN_SHOP_LOGO_CLASS, 'bg-muted object-cover')}
    />
  );
}
