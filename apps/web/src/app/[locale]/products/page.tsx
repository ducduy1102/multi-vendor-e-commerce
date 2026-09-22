import { listProductsQuerySchema } from '@ecommerce/types';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import {
  PRODUCTS_PAGE_GRID_CLASS,
  ProductFilterBar,
  ProductGridSkeleton,
  ProductListResults,
  productService,
} from '@/modules/product';
import { Container } from '@/shared/components/Container';

interface ProductsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc filter qua searchParams (không dùng
// useSearchParams(), đúng rules/frontend.md mục 2). listProductsQuerySchema
// (dùng chung với BE qua @ecommerce/types) tự coerce string -> number và áp
// default (page=1/limit=12/sort=newest) khi param không có trong URL.
export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const rawParams = await searchParams;
  const parsed = listProductsQuerySchema.safeParse(rawParams);
  // URL bị chỉnh tay sai dạng (vd page=abc) không nên làm sập cả trang —
  // rơi về default giống như không có query nào, thay vì throw lên error boundary.
  const query = parsed.success ? parsed.data : listProductsQuerySchema.parse({});

  // Chỉ còn categories ở đây — categories phục vụ ProductFilterBar (phần
  // TĨNH, không phụ thuộc filter/trang hiện tại) nên KHÔNG bọc Suspense,
  // ngược lại với listProducts(query) (phần phụ thuộc query, đổi mỗi lần
  // filter/trang đổi) — tách vào ProductListResults.tsx, bọc <Suspense>
  // riêng để đổi filter không chặn re-render cả sidebar/tiêu đề.
  const t = await getTranslations('product');
  const categories = await productService.getCategories();

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('listTitle')}</h1>

          {/* Sidebar dọc bên trái (filter) + nội dung bên phải — xếp chồng
              dọc ở mobile (filter trước, danh sách sau), nằm cạnh nhau từ
              breakpoint lg. */}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <aside className="w-full shrink-0 lg:w-64">
              <ProductFilterBar
                categories={categories}
                initialFilters={{
                  categoryId: query.categoryId,
                  minPrice: query.minPrice,
                  maxPrice: query.maxPrice,
                  sort: query.sort,
                }}
              />
            </aside>

            <div className="flex flex-1 flex-col gap-6">
              <Suspense
                // key theo query — đã verify bằng Playwright (chặn network
                // giả lập chậm) rằng KHÔNG có key này, Suspense không tự
                // suspend lại khi searchParams đổi trên cùng route (chỉ
                // suspend đúng 1 lần ở lần điều hướng đầu tới /products) —
                // gotcha đã biết của Next.js App Router, không phải lỗi
                // ProductListResults. key đổi buộc React coi đây là 1
                // instance mới, tự suspend lại đúng ý.
                key={JSON.stringify(query)}
                fallback={<ProductGridSkeleton gridClassName={PRODUCTS_PAGE_GRID_CLASS} />}
              >
                <ProductListResults query={query} />
              </Suspense>
            </div>
          </div>
        </Container>
      </main>
    </div>
  );
}
