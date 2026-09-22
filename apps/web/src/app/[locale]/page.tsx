import { Suspense } from 'react';

import { HomeCatalog, HomeCatalogSkeleton } from '@/modules/product';
import { Container } from '@/shared/components/Container';
import { HomeBanner } from '@/shared/components/HomeBanner';

// Server Component — page.tsx chỉ compose HomeBanner (render ngay, không
// phụ thuộc fetch nào) + HomeCatalog (async, gọi listProducts/getCategories,
// bọc <Suspense> để không chặn HomeBanner hiện ngay lập tức). Logic thật
// (fetch, ẩn/hiện category, lưới sản phẩm) nằm trong modules/product/
// components/HomeCatalog.tsx — đúng rules/frontend.md mục 1 "page.tsx chỉ
// compose".
//
// Không còn async/await ở đây (vercel-react-best-practices, server-parallel-
// fetching) — trước đó await getTranslations('product') chỉ để lấy chuỗi
// cho fallback khiến <HomeBanner /> bị delay theo dù không phụ thuộc gì.
// HomeCatalogSkeleton giờ tự gọi getTranslations bên trong nó.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-10 py-10">
          <HomeBanner />

          <Suspense fallback={<HomeCatalogSkeleton />}>
            <HomeCatalog />
          </Suspense>
        </Container>
      </main>
    </div>
  );
}
