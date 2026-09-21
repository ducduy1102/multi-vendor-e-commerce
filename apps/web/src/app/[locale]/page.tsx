import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { HomeCatalog, HomeCatalogSkeleton } from '@/modules/product';
import { HomeHero } from '@/shared/components/HomeHero';

// Server Component — page.tsx chỉ compose Hero (render ngay, không phụ
// thuộc fetch nào) + HomeCatalog (async, gọi listProducts/getCategories,
// bọc <Suspense> để không chặn Hero hiện ngay lập tức). Logic thật (fetch,
// ẩn/hiện category, lưới sản phẩm) nằm trong modules/product/components/
// HomeCatalog.tsx — đúng rules/frontend.md mục 1 "page.tsx chỉ compose".
export default async function Home() {
  const t = await getTranslations('product');

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6">
        <HomeHero />

        <Suspense fallback={<HomeCatalogSkeleton loadingLabel={t('homeLoadingSrOnly')} />}>
          <HomeCatalog />
        </Suspense>
      </main>
    </div>
  );
}
