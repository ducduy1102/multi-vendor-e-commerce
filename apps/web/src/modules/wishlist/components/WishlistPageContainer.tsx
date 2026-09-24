'use client';

import { useTranslations } from 'next-intl';

import {
  HOME_CATALOG_GRID_CLASS,
  ProductGridSkeleton,
  ProductPreviewCard,
} from '@/modules/product';
import { useMyWishlist } from '../hooks/useMyWishlist';

// Week5.md Bước 3.7 — fetch qua TanStack Query (client, khác trang chủ/
// /products là Server Component SSR) vì đây là dữ liệu cá nhân hoá theo
// session, không có ý nghĩa cache theo URL công khai. Tái dùng nguyên
// ProductPreviewCard/ProductGridSkeleton từ modules/product (qua barrel,
// đúng ngoại lệ cross-import UI thuần — rules/frontend.md mục 1) — không
// viết lại card hay skeleton riêng cho trang này.
export function WishlistPageContainer() {
  const t = useTranslations('wishlist');
  const tCommon = useTranslations('common');
  const wishlistQuery = useMyWishlist();

  if (wishlistQuery.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <ProductGridSkeleton gridClassName={HOME_CATALOG_GRID_CLASS} />
      </div>
    );
  }

  if (wishlistQuery.isError) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>;
  }

  if (wishlistQuery.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('emptyState')}</p>;
  }

  return (
    <div className={HOME_CATALOG_GRID_CLASS}>
      {wishlistQuery.data.items.map((item) => (
        <ProductPreviewCard
          key={item.id}
          product={item}
          isAvailable={item.isAvailable}
          unavailableLabel={t('unavailableBadge')}
        />
      ))}
    </div>
  );
}
