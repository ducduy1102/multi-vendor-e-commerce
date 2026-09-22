'use client';

import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { Label } from '@/shared/components/ui/label';
import { cn } from '@/shared/lib/utils';
import type { Category, ListProductsQuery } from '../types';
import { PriceRangeFilter } from './PriceRangeFilter';

interface ProductFilterBarProps {
  categories: Category[];
  initialFilters: {
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    sort: ListProductsQuery['sort'];
  };
}

const selectClassName =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

// Khoảng giá slider cố định (VND) — chưa có aggregation query thống kê
// min/max giá thật của toàn sàn (ngoài phạm vi hiện tại), dùng ngưỡng cố
// định đủ cho catalog demo. `minPrice`/`maxPrice` chỉ set lên URL khi khác
// biên mặc định, tránh URL dư thừa lúc chưa thu hẹp khoảng giá.
const PRICE_MIN = 0;
const PRICE_MAX = 1_000_000_000;
const PRICE_STEP = 50_000;

interface PricePreset {
  key: string;
  minPrice?: number;
  maxPrice?: number;
  labelKey:
    | 'pricePresetUnder1m'
    | 'pricePreset1mTo5m'
    | 'pricePreset5mTo10m'
    | 'pricePreset10mTo20m'
    | 'pricePresetOver20m';
}

// Chọn nhanh 1 khoảng giá thường gặp (single-select, giống radio) — không
// phải checkbox chọn được nhiều khoảng rời nhau cùng lúc: BE
// `listPublicProducts` chỉ hỗ trợ đúng 1 khoảng minPrice-maxPrice (AND),
// không hỗ trợ OR nhiều khoảng, nên chỉ cho chọn 1 preset tại 1 thời điểm.
// "Trên 20 triệu" bỏ trống maxPrice (không ép về PRICE_MAX) — đúng ngữ nghĩa
// "từ 20 triệu trở lên", không giới hạn trần.
const PRICE_PRESETS: PricePreset[] = [
  { key: 'under-1m', maxPrice: 1_000_000, labelKey: 'pricePresetUnder1m' },
  { key: '1m-5m', minPrice: 1_000_000, maxPrice: 5_000_000, labelKey: 'pricePreset1mTo5m' },
  { key: '5m-10m', minPrice: 5_000_000, maxPrice: 10_000_000, labelKey: 'pricePreset5mTo10m' },
  { key: '10m-20m', minPrice: 10_000_000, maxPrice: 20_000_000, labelKey: 'pricePreset10mTo20m' },
  { key: 'over-20m', minPrice: 20_000_000, labelKey: 'pricePresetOver20m' },
];

// Client Component tương tác — đổi query param qua router.push (đúng
// rules/frontend.md mục 2/1.6). Bố cục dọc (sidebar) — categoryId/sort/preset
// giá push URL ngay khi đổi; slider khoảng giá (PriceRangeFilter) tự debounce
// trước khi gọi onChange. Mọi lần đổi filter đều bỏ `page` khỏi URL mới
// (reset về trang 1) — chỉ link phân trang mới set page.
export function ProductFilterBar({ categories, initialFilters }: ProductFilterBarProps) {
  const t = useTranslations('product');
  const router = useRouter();

  function pushQuery(
    overrides: Partial<Record<'categoryId' | 'minPrice' | 'maxPrice' | 'sort', string>>,
  ) {
    const next = {
      categoryId: initialFilters.categoryId,
      minPrice: initialFilters.minPrice?.toString(),
      maxPrice: initialFilters.maxPrice?.toString(),
      sort: initialFilters.sort === 'newest' ? undefined : initialFilters.sort,
      ...overrides,
    };
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (value) {
        query[key] = value;
      }
    }
    router.push({ pathname: '/products', query });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-category">{t('filterCategoryLabel')}</Label>
        <select
          id="filter-category"
          className={selectClassName}
          value={initialFilters.categoryId ?? ''}
          onChange={(event) => pushQuery({ categoryId: event.target.value || undefined })}
        >
          <option value="">{t('filterAllCategories')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.parentId ? `— ${category.name}` : category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-sort">{t('filterSortLabel')}</Label>
        <select
          id="filter-sort"
          className={selectClassName}
          value={initialFilters.sort}
          onChange={(event) => pushQuery({ sort: event.target.value })}
        >
          <option value="newest">{t('sortNewest')}</option>
          <option value="price-asc">{t('sortPriceAsc')}</option>
          <option value="price-desc">{t('sortPriceDesc')}</option>
        </select>
      </div>

      <div className="flex flex-col gap-3">
        <Label>{t('filterPriceLabel')}</Label>

        <div className="flex flex-col gap-2">
          {PRICE_PRESETS.map((preset) => {
            const isActive =
              initialFilters.minPrice === preset.minPrice &&
              initialFilters.maxPrice === preset.maxPrice;
            return (
              <label
                key={preset.key}
                className={cn(
                  'flex items-center gap-2 text-sm',
                  isActive ? 'font-medium text-primary' : 'text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="price-preset"
                  checked={isActive}
                  onChange={() =>
                    pushQuery({
                      minPrice: preset.minPrice?.toString(),
                      maxPrice: preset.maxPrice?.toString(),
                    })
                  }
                  className="size-4 accent-primary"
                />
                {t(preset.labelKey)}
              </label>
            );
          })}
        </div>

        <PriceRangeFilter
          key={`${initialFilters.minPrice ?? ''}-${initialFilters.maxPrice ?? ''}`}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          initialValue={[
            initialFilters.minPrice ?? PRICE_MIN,
            initialFilters.maxPrice ?? PRICE_MAX,
          ]}
          onChange={([nextMin, nextMax]) =>
            pushQuery({
              minPrice: nextMin > PRICE_MIN ? String(nextMin) : undefined,
              maxPrice: nextMax < PRICE_MAX ? String(nextMax) : undefined,
            })
          }
        />
      </div>
    </div>
  );
}
