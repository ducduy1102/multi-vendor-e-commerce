import { listProductsQuerySchema } from '@ecommerce/types';
import { getTranslations } from 'next-intl/server';

import {
  ProductFilterBar,
  ProductPagination,
  ProductPreviewCard,
  productService,
} from '@/modules/product';

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

  const t = await getTranslations('product');
  const [{ items, total, page, limit }, categories] = await Promise.all([
    productService.listProducts(query),
    productService.getCategories(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (query.categoryId) params.set('categoryId', query.categoryId);
    if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
    if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
    if (query.sort !== 'newest') params.set('sort', query.sort);
    params.set('page', String(targetPage));
    return `/products?${params.toString()}`;
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-foreground">{t('listTitle')}</h1>

        {/* Sidebar dọc bên trái (filter) + nội dung bên phải — xếp chồng
            dọc ở mobile (filter trước, danh sách sau), nằm cạnh nhau từ
            breakpoint lg. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:w-64">
            <ProductFilterBar
              // key ép remount mỗi khi filter trên URL đổi (kể cả điều hướng
              // từ nơi khác, nút back/forward) — ProductFilterBar/
              // PriceRangeFilter giữ state nội bộ (range khoảng giá) khởi
              // tạo 1 lần lúc mount từ props, không tự resync nếu chỉ đổi
              // props mà giữ nguyên instance.
              key={`${query.categoryId ?? ''}-${query.minPrice ?? ''}-${query.maxPrice ?? ''}-${query.sort}`}
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
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('homeEmptyState')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((product) => (
                  <ProductPreviewCard key={product.id} product={product} />
                ))}
              </div>
            )}

            <ProductPagination
              page={page}
              totalPages={totalPages}
              prevHref={buildPageHref(Math.max(1, page - 1))}
              nextHref={buildPageHref(Math.min(totalPages, page + 1))}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
