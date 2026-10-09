import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';

import { Link } from '@/i18n/navigation';
import { StarRating } from '@/shared/components/StarRating';
import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/utils';
import { formatPrice } from '../format-price';
import type { ProductCard } from '../types';

interface ProductPreviewCardProps {
  product: ProductCard;
  // Mặc định false — chỉ trang chủ truyền true cho vài item đầu (nhiều khả
  // năng là LCP element), /products không truyền nên giữ nguyên hành vi cũ
  // (lazy-load mọi ảnh). Component dùng chung cho cả 2 trang (đã chốt ở
  // rules/frontend.md mục 13), không tách bản riêng cho từng trang.
  priority?: boolean;
  // Week5.md Bước 1.17/3.7 — chỉ trang wishlist truyền (ProductCard gốc từ
  // /products, trang chủ không có field này, luôn mặc định true). false =
  // sản phẩm/shop đã bị archive/suspend sau khi user đã wishlist — hiện
  // badge mờ + KHÔNG cho bấm vào trang chi tiết (trang đó sẽ tự trả 404 vì
  // không còn PUBLISHED/APPROVED, tránh UX cụt hứng). Nhận `unavailableLabel`
  // qua prop — chuỗi này chỉ có nghĩa ở ngữ cảnh wishlist nên để nơi gọi
  // quyết định. (Từ Tuần 9 card có dùng useTranslations cho nhãn số đánh giá,
  // hook của next-intl chạy được ở cả Server Component — trang chủ,
  // `/products` — lẫn Client Component — trang wishlist, Bước 3.7, fetch qua
  // TanStack Query — nên không phá "dùng được ở cả hai cây"; test của card
  // phải bọc withIntl.)
  isAvailable?: boolean;
  unavailableLabel?: string;
}

// Component thuần trình bày (không gọi API) — không bắt buộc test riêng cho
// bản gốc chỉ hiện thị (rules/frontend.md mục 8), nhưng từ Bước 3.7 đã có
// nhánh điều kiện thật (isAvailable) nên có test riêng (ProductPreviewCard.test.tsx).
export function ProductPreviewCard({
  product,
  priority = false,
  isAvailable = true,
  unavailableLabel,
}: ProductPreviewCardProps) {
  const t = useTranslations('product');
  const priceLabel =
    product.minPrice === product.maxPrice
      ? formatPrice(product.minPrice)
      : `${formatPrice(product.minPrice)} - ${formatPrice(product.maxPrice)}`;

  const media = (
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
          className={cn(
            'object-cover transition-transform',
            isAvailable ? 'group-hover:scale-105' : 'opacity-60 grayscale',
          )}
        />
      ) : (
        <div className="flex size-full items-center justify-center" aria-hidden="true">
          <ImageOff className="size-8 text-muted-foreground" />
        </div>
      )}
      {!isAvailable && unavailableLabel ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Badge variant="outline" className="bg-background">
            {unavailableLabel}
          </Badge>
        </div>
      ) : null}
    </div>
  );

  const info = (
    <div className={cn('flex flex-col gap-1 p-3', !isAvailable && 'opacity-60')}>
      <span className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</span>
      <span className="text-sm font-semibold text-foreground">{priceLabel}</span>
      {/* Hàng sao LUÔN chiếm chiều cao cố định (h-4) kể cả khi chưa có đánh giá: mọi thẻ cao bằng nhau
          và ProductCardSkeleton khớp đúng, không nhảy layout khi dữ liệu về. */}
      <div className="flex h-4 items-center gap-1">
        {product.reviewCount > 0 ? (
          <>
            <StarRating value={product.avgRating} size="sm" />
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              ({product.reviewCount})
            </span>
            <span className="sr-only">{t('cardReviewCount', { count: product.reviewCount })}</span>
          </>
        ) : null}
      </div>
    </div>
  );

  if (!isAvailable) {
    return (
      <div
        aria-disabled="true"
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-background"
      >
        {media}
        {info}
      </div>
    );
  }

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-shadow hover:shadow-md"
    >
      {media}
      {info}
    </Link>
  );
}
