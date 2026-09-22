import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getTopLevelCategories } from '../get-top-level-categories';
import * as productService from '../services/product.service';
import { CategoryShortcutList } from './CategoryShortcutList';
import { HOME_PRODUCT_GRID_CLASS, HOME_PRODUCTS_LIMIT } from './HomeCatalog.constants';
import { ProductPreviewCard } from './ProductPreviewCard';

// Server Component async — bọc trong <Suspense> ở page.tsx (fallback
// HomeCatalogSkeleton) thay vì render đồng bộ trực tiếp như trước, để
// Hero hiện ngay lập tức không phải chờ 2 fetch bên dưới. KHÔNG đổi hành
// vi dynamic (ƒ) của route hay thêm cache/revalidate — apiFetch vẫn dùng
// fetch() trần như cũ (rules/frontend.md mục 13: sản phẩm publish/archive
// phải hiện ngay).
export async function HomeCatalog() {
  const t = await getTranslations('product');
  const [{ items: products }, categories] = await Promise.all([
    productService.listProducts({ limit: HOME_PRODUCTS_LIMIT }),
    productService.getCategories(),
  ]);
  // Tính 1 lần, dùng chung với CategoryShortcutList (nhận mảng đã lọc sẵn
  // qua prop, không tự lọc lại) — không dùng categories.length thô để ẩn/
  // hiện section: categories gốc có thể không rỗng (còn category con) dù
  // không có category cấp cha nào, vẫn phải ẩn heading trong trường hợp đó.
  const topLevelCategories = getTopLevelCategories(categories);

  return (
    <>
      {topLevelCategories.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('homeCategoriesTitle')}</h2>
          <CategoryShortcutList categories={topLevelCategories} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('homeNewestTitle')}</h2>
          <Link
            href="/products"
            className="text-sm font-medium text-primary transition-colors hover:underline"
          >
            {t('viewAllLink')}
          </Link>
        </div>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('homeEmptyState')}</p>
        ) : (
          <div className={HOME_PRODUCT_GRID_CLASS}>
            {products.map((product, index) => (
              <ProductPreviewCard key={product.id} product={product} priority={index < 4} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
