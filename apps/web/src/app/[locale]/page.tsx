import { getTranslations } from 'next-intl/server';

import {
  CategoryShortcutList,
  getTopLevelCategories,
  ProductPreviewCard,
  productService,
} from '@/modules/product';
import { HomeHero } from '@/shared/components/HomeHero';

// Server Component — gọi thẳng listProducts (SSR, không cần TanStack Query
// cho lần fetch đầu, đúng rules/frontend.md mục 2). Cùng query mặc định
// (sort=newest, limit nhỏ) dùng chung với trang danh sách public (Bước 3.4)
// và BE listPublicProducts (Week4.md Bước 1.12) — không tách endpoint riêng.
export default async function Home() {
  const t = await getTranslations('product');
  const [{ items: products }, categories] = await Promise.all([
    productService.listProducts({ limit: 8 }),
    productService.getCategories(),
  ]);
  // Tính 1 lần, dùng chung với CategoryShortcutList (nhận mảng đã lọc sẵn
  // qua prop, không tự lọc lại) — không dùng categories.length thô để ẩn/
  // hiện section: categories gốc có thể không rỗng (còn category con) dù
  // không có category cấp cha nào, vẫn phải ẩn heading trong trường hợp đó.
  const topLevelCategories = getTopLevelCategories(categories);

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6">
        <HomeHero />

        {topLevelCategories.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-foreground">{t('homeCategoriesTitle')}</h2>
            <CategoryShortcutList categories={topLevelCategories} />
          </section>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('homeNewestTitle')}</h2>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('homeEmptyState')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product, index) => (
                <ProductPreviewCard key={product.id} product={product} priority={index < 4} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
