import { getTranslations } from 'next-intl/server';

import { CategoryShortcutList, ProductPreviewCard, productService } from '@/modules/product';

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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6">
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('homeCategoriesTitle')}</h2>
          <CategoryShortcutList categories={categories} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t('homeNewestTitle')}</h2>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('homeEmptyState')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductPreviewCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
