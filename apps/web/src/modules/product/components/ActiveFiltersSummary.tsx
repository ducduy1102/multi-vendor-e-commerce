import { X } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { formatPrice } from '../format-price';
import type { Category, ListProductsQuery } from '../types';

interface ActiveFiltersSummaryProps {
  query: ListProductsQuery;
  categories: Category[];
  removeSearchLabel: string;
  removeCategoryLabel: string;
  removePriceLabel: string;
}

// Chỉ bỏ ĐÚNG 1 field (q, hoặc categoryId, hoặc cả minPrice+maxPrice — coi
// là 1 filter giá duy nhất, giống cách preset/slider trong
// ProductFilterBar.tsx luôn set cả 2 cùng lúc), giữ nguyên các filter khác +
// sort. Không set lại `page` — bỏ filter đổi kết quả nên reset về trang 1,
// giống mọi lần đổi filter khác (ProductFilterBar.tsx).
function buildRemoveFilterHref(
  query: ListProductsQuery,
  omit: 'q' | 'categoryId' | 'price',
): string {
  const params = new URLSearchParams();
  if (omit !== 'q' && query.q) params.set('q', query.q);
  if (omit !== 'categoryId' && query.categoryId) params.set('categoryId', query.categoryId);
  if (omit !== 'price' && query.minPrice !== undefined) {
    params.set('minPrice', String(query.minPrice));
  }
  if (omit !== 'price' && query.maxPrice !== undefined) {
    params.set('maxPrice', String(query.maxPrice));
  }
  if (query.sort !== 'newest') params.set('sort', query.sort);
  const queryString = params.toString();
  return `/products${queryString ? `?${queryString}` : ''}`;
}

// Server Component thuần (không "use client") — chỉ build href từ `query`
// đã parse sẵn ở page.tsx (searchParams) + `categories` (đã fetch sẵn cho
// ProductFilterBar), không tự fetch gì nên không cần bọc Suspense, hiện
// ngay cùng lúc với <h1>. Badge "xoá filter" là <Link> điều hướng thường
// (không phải nút bấm gọi JS), vẫn hoạt động không cần client JS.
//
// Badge "q" (search) thêm sau khi bỏ hẳn ô input search riêng khỏi
// ProductFilterBar — Header đã có search toàn cục (kể cả khi đang ở
// /products), giữ thêm 1 ô input y hệt trong sidebar là dư thừa (người dùng
// phát hiện). Badge ở đây chỉ còn vai trò "thấy + xoá nhanh" từ khoá đang
// tìm, không phải chỗ để GÕ lại (đúng vai trò badge category/price cạnh nó).
export function ActiveFiltersSummary({
  query,
  categories,
  removeSearchLabel,
  removeCategoryLabel,
  removePriceLabel,
}: ActiveFiltersSummaryProps) {
  const activeCategory = query.categoryId
    ? categories.find((category) => category.id === query.categoryId)
    : undefined;
  const hasPriceFilter = query.minPrice !== undefined || query.maxPrice !== undefined;

  if (!query.q && !activeCategory && !hasPriceFilter) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {query.q && (
        <Badge variant="secondary" render={<Link href={buildRemoveFilterHref(query, 'q')} />}>
          {query.q}
          <X className="size-3" aria-hidden="true" />
          <span className="sr-only">{removeSearchLabel}</span>
        </Badge>
      )}
      {activeCategory && (
        <Badge
          variant="secondary"
          render={<Link href={buildRemoveFilterHref(query, 'categoryId')} />}
        >
          {activeCategory.name}
          <X className="size-3" aria-hidden="true" />
          <span className="sr-only">{removeCategoryLabel}</span>
        </Badge>
      )}
      {hasPriceFilter && (
        <Badge variant="secondary" render={<Link href={buildRemoveFilterHref(query, 'price')} />}>
          {formatPrice(String(query.minPrice ?? 0))}
          {' – '}
          {query.maxPrice !== undefined ? formatPrice(String(query.maxPrice)) : '∞'}
          <X className="size-3" aria-hidden="true" />
          <span className="sr-only">{removePriceLabel}</span>
        </Badge>
      )}
    </div>
  );
}
