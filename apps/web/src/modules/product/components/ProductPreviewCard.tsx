import { ImageOff } from 'lucide-react';
import Image from 'next/image';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '../format-price';
import type { ProductCard } from '../types';

interface ProductPreviewCardProps {
  product: ProductCard;
  // Mặc định false — chỉ trang chủ truyền true cho vài item đầu (nhiều khả
  // năng là LCP element), /products không truyền nên giữ nguyên hành vi cũ
  // (lazy-load mọi ảnh). Component dùng chung cho cả 2 trang (đã chốt ở
  // rules/frontend.md mục 13), không tách bản riêng cho từng trang.
  priority?: boolean;
}

// Component thuần trình bày (không gọi API) — không bắt buộc test riêng
// (rules/frontend.md mục 8). Link trỏ /products/:slug — route thật (Tuần 5,
// Week4.md Bước 3.5) chưa tồn tại, chỉ tránh phải sửa lại link 2 lần.
export function ProductPreviewCard({ product, priority = false }: ProductPreviewCardProps) {
  const priceLabel =
    product.minPrice === product.maxPrice
      ? formatPrice(product.minPrice)
      : `${formatPrice(product.minPrice)} - ${formatPrice(product.maxPrice)}`;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            // "" (thuần trang trí) — tên sản phẩm đã hiện ngay bên dưới,
            // trong CÙNG 1 Link, screen reader không cần đọc lại tên 2 lần
            // liên tiếp khi focus vào link (đúng khuyến nghị WCAG cho ảnh +
            // text trùng nghĩa nằm chung 1 link).
            alt=""
            fill
            // 1280px trở lên: trang chủ lên xl:grid-cols-5 (20vw/thẻ, xem
            // HomeCatalog.constants.ts) — /products vẫn dừng ở 4 cột (25vw)
            // nên hơi thừa 1 chút ở đúng breakpoint này trên /products,
            // chấp nhận được (ProductPreviewCard dùng chung cho cả 2 trang,
            // rules/frontend.md mục 13).
            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            priority={priority}
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center" aria-hidden="true">
            <ImageOff className="size-8 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</span>
        <span className="text-sm font-semibold text-foreground">{priceLabel}</span>
      </div>
    </Link>
  );
}
