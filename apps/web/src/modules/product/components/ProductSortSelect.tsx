'use client';

import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { Label } from '@/shared/components/ui/label';

import type { ListProductsQuery } from '../types';

interface ProductSortSelectProps {
  value: ListProductsQuery['sort'];
  // Path của trang đang đứng (không kèm query) — vd `/shops/my-shop`. Đổi cách sắp xếp luôn về trang 1:
  // trang đang xem thuộc thứ tự cũ nên không còn nghĩa.
  basePath: string;
}

// Native <select> (không thêm primitive Select của shadcn — chưa được duyệt, cùng quyết định ở
// ProductFilterBar/AddressForm), style khớp Input để đồng bộ giao diện và focus-visible.
const SELECT_CLASS =
  'h-8 min-w-40 rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

// Ô "Sắp xếp" đứng riêng cho trang danh sách KHÔNG có bộ lọc đầy đủ (trang shop công khai, Week9.md 6.3) —
// ProductFilterBar vẫn giữ ô sắp xếp riêng nằm trong sidebar filter của /products. Cùng bốn lựa chọn và cùng
// nhãn (namespace `product`) để hai nơi không lệch nhau; `newest` là mặc định nên không đưa vào URL (link gọn,
// trùng URL người dùng tự gõ).
export function ProductSortSelect({ value, basePath }: ProductSortSelectProps) {
  const t = useTranslations('product');
  const router = useRouter();

  function handleChange(next: string) {
    router.push(next === 'newest' ? basePath : `${basePath}?sort=${encodeURIComponent(next)}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="product-sort" className="text-sm text-muted-foreground">
        {t('filterSortLabel')}
      </Label>
      <select
        id="product-sort"
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
      >
        <option value="newest">{t('sortNewest')}</option>
        <option value="price-asc">{t('sortPriceAsc')}</option>
        <option value="price-desc">{t('sortPriceDesc')}</option>
        <option value="rating">{t('sortRating')}</option>
      </select>
    </div>
  );
}
