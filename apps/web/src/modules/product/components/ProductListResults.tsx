import { getTranslations } from 'next-intl/server';

import * as productService from '../services/product.service';
import type { ListProductsQuery } from '../types';
import { PRODUCTS_PAGE_GRID_CLASS } from './HomeCatalog.constants';
import { ProductPagination } from './ProductPagination';
import { ProductPreviewCard } from './ProductPreviewCard';

interface ProductListResultsProps {
  query: ListProductsQuery;
}

// Server Component async — bọc trong <Suspense> ở page.tsx (fallback
// ProductGridSkeleton), tách khỏi phần tĩnh (h1, ProductFilterBar) để đổi
// filter/trang không chặn render lại toàn bộ page.tsx, giống cách
// HomeCatalog tách khỏi HomeBanner. KHÔNG đổi hành vi dynamic (ƒ) của route
// hay thêm cache/revalidate — productService.listProducts vẫn gọi apiFetch
// trần như cũ.
export async function ProductListResults({ query }: ProductListResultsProps) {
  const t = await getTranslations('product');
  const { items, total, page, limit } = await productService.listProducts(query);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  // Có filter đang áp dụng (không tính `sort` — đổi cách sắp xếp không thu
  // hẹp kết quả) → dùng thông báo rỗng khác "chưa có sản phẩm nào" của
  // trang chủ, tránh hiểu lầm cả sàn chưa có sản phẩm gì.
  const hasActiveFilters =
    query.categoryId !== undefined || query.minPrice !== undefined || query.maxPrice !== undefined;

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (query.categoryId) params.set('categoryId', query.categoryId);
    if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
    if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
    if (query.sort !== 'newest') params.set('sort', query.sort);
    params.set('page', String(targetPage));
    return `/products?${params.toString()}`;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">{t('resultCount', { count: total })}</p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasActiveFilters ? t('filterEmptyState') : t('homeEmptyState')}
        </p>
      ) : (
        <div className={PRODUCTS_PAGE_GRID_CLASS}>
          {items.map((product) => (
            <ProductPreviewCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <ProductPagination
        page={page}
        totalPages={totalPages}
        prevHref={buildPageHref(Math.max(1, page - 1))}
        nextHref={buildPageHref(Math.min(totalPages, page + 1))}
      />
    </>
  );
}
