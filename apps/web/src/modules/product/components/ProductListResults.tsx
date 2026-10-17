import { getTranslations } from 'next-intl/server';

import * as productService from '../services/product.service';
import type { ListProductsQuery, ProductListResponse } from '../types';
import { PRODUCTS_PAGE_GRID_CLASS } from './HomeCatalog.constants';
import { ProductPagination } from './ProductPagination';
import { ProductPreviewCard } from './ProductPreviewCard';

interface ProductListResultsProps {
  query: ListProductsQuery;
  // Mặc định `/products`. Trang khác dùng lại component này (vd `/shops/[slug]`, Week9.md 6.3) truyền path
  // của chính nó để link "Trước/Sau" không trỏ nhầm sang /products. Chỉ phần query (filter/sort/page) do
  // component dựng; path cố định do nơi gọi.
  basePath?: string;
  // Mặc định PRODUCTS_PAGE_GRID_CLASS (3-4 cột vì /products có sidebar filter). Trang không có sidebar
  // truyền lưới rộng hơn — nhớ dùng CÙNG hằng số với skeleton để hai bên không lệch nhau.
  gridClassName?: string;
  // Câu hiện khi không có sản phẩm. Bỏ trống ⇒ chọn theo có/không filter như cũ.
  emptyMessage?: string;
  // Nơi gọi đã BẮT ĐẦU tải sẵn (song song với việc khác, vd tải shop) — component chỉ `await` kết quả thay
  // vì tự gọi API ở lúc render, tránh waterfall (rules/frontend.md "UI polish" mục 9). Bỏ trống ⇒ tự gọi
  // productService.listProducts(query) như cũ.
  resultsPromise?: Promise<ProductListResponse>;
}

// Server Component async — bọc trong <Suspense> ở page.tsx (fallback
// ProductGridSkeleton), tách khỏi phần tĩnh (h1, ProductFilterBar) để đổi
// filter/trang không chặn render lại toàn bộ page.tsx, giống cách
// HomeCatalog tách khỏi HomeBanner. KHÔNG đổi hành vi dynamic (ƒ) của route
// hay thêm cache/revalidate — productService.listProducts vẫn gọi apiFetch
// trần như cũ.
export async function ProductListResults({
  query,
  basePath = '/products',
  gridClassName = PRODUCTS_PAGE_GRID_CLASS,
  emptyMessage,
  resultsPromise,
}: ProductListResultsProps) {
  const t = await getTranslations('product');
  const { items, total, page, limit } = await (resultsPromise ??
    productService.listProducts(query));
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
    return `${basePath}?${params.toString()}`;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">{t('resultCount', { count: total })}</p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? (hasActiveFilters ? t('filterEmptyState') : t('homeEmptyState'))}
        </p>
      ) : (
        <div className={gridClassName}>
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
