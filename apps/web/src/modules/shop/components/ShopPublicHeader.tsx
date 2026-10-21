import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { StarRating } from '@/shared/components/StarRating';
import { toSafeImageUrl } from '@/shared/lib/safe-image-url';

import type { PublicShop } from '../types';
import { ShopPublicBanner, ShopPublicLogo } from './ShopPublicMedia';

interface ShopPublicHeaderProps {
  shop: PublicShop;
  // Nút "Chat với shop" do page.tsx ghép vào (module shop không được import module chat — rules/general.md mục 1);
  // không truyền thì không có chỗ chat.
  chatSlot?: ReactNode;
}

// Đầu trang shop công khai (/shops/[slug], Week9.md 1.10/6.3): banner, logo, tên, điểm đánh giá gộp của các
// sản phẩm, số sản phẩm, ngày tham gia, mô tả, nút chat. Server Component thuần trình bày (chỉ ShopPublic
// Banner/Logo là client vì cần xử lý ảnh lỗi) — không gọi API, nhận `shop` đã tải sẵn từ page.tsx.
//
// Chữ do chủ shop nhập (tên ≤ 100, mô tả ≤ 2000 ký tự, có thể là chuỗi dài không dấu cách): cột chữ khai
// tường minh `grid-cols-1` / `minmax(0,1fr)` thay vì `grid` trần có cột ngầm `auto` lấy min-content
// (rules/frontend.md mục 5), cột con `min-w-0` + `break-words`.
export function ShopPublicHeader({ shop, chatSlot }: ShopPublicHeaderProps) {
  const t = useTranslations('shop');
  const format = useFormatter();

  return (
    <header className="flex flex-col gap-4">
      <ShopPublicBanner src={toSafeImageUrl(shop.bannerUrl)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="flex min-w-0 items-start gap-3">
          <ShopPublicLogo src={toSafeImageUrl(shop.logoUrl)} />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="text-xl font-semibold break-words text-foreground">{shop.name}</h1>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {shop.reviewCount > 0 ? (
                <>
                  {/* Điểm số aria-hidden: nhãn của StarRating ("4,3 trên 5 sao") đã đọc ra rồi. */}
                  <span aria-hidden="true" className="font-medium text-foreground">
                    {format.number(shop.avgRating, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </span>
                  <StarRating value={shop.avgRating} size="md" />
                  <span>{t('publicReviewCount', { count: shop.reviewCount })}</span>
                </>
              ) : (
                <span>{t('publicNoReviews')}</span>
              )}
            </div>

            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              <span>{t('publicProductCount', { count: shop.productCount })}</span>
              <span>
                {t('publicJoined', {
                  // UTC cố định: chỉ cần tháng/năm, và Server Component với client phải ra cùng chuỗi
                  // (múi giờ máy chủ khác trình duyệt sẽ lệch tháng ở sát ranh giới).
                  date: format.dateTime(new Date(shop.createdAt), {
                    year: 'numeric',
                    month: 'long',
                    timeZone: 'UTC',
                  }),
                })}
              </span>
            </p>
          </div>
        </div>

        {/* Chỗ nút "Chat với shop" (Week10.md 5.4): page.tsx truyền `chatSlot` — nút cần biết người xem đã đăng
            nhập chưa và có phải chủ shop này không, là thứ module shop không được biết (không import chat/auth). */}
        {chatSlot ? <div className="flex flex-col items-start lg:items-end">{chatSlot}</div> : null}
      </div>

      {shop.description ? (
        <p className="text-sm break-words whitespace-pre-line text-foreground">
          {shop.description}
        </p>
      ) : null}
    </header>
  );
}
