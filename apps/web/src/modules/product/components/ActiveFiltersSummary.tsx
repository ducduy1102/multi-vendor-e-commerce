import { X } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { formatPrice } from '../format-price';
import type { Category, ListProductsQuery } from '../types';

interface ActiveFiltersSummaryProps {
  query: ListProductsQuery;
  categories: Category[];
  removeCategoryLabel: string;
  removePriceLabel: string;
}

// Chỉ bỏ ĐÚNG 1 field (categoryId hoặc cả minPrice+maxPrice — coi là 1 filter
// giá duy nhất, giống cách preset/slider trong ProductFilterBar.tsx luôn set
// cả 2 cùng lúc), giữ nguyên các filter khác + sort. Không set lại `page`
// — bỏ filter đổi kết quả nên reset về trang 1, giống mọi lần đổi filter
// khác (ProductFilterBar.tsx).
function buildRemoveFilterHref(query: ListProductsQuery, omit: 'categoryId' | 'price'): string {
  const params = new URLSearchParams();
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
export function ActiveFiltersSummary({
  query,
  categories,
  removeCategoryLabel,
  removePriceLabel,
}: ActiveFiltersSummaryProps) {
  const activeCategory = query.categoryId
    ? categories.find((category) => category.id === query.categoryId)
    : undefined;
  const hasPriceFilter = query.minPrice !== undefined || query.maxPrice !== undefined;

  if (!activeCategory && !hasPriceFilter) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
