import { listProductsQuerySchema } from '@ecommerce/types';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { cache, Suspense } from 'react';

import {
  HOME_CATALOG_GRID_CLASS,
  ProductGridSkeleton,
  ProductListResults,
  ProductSortSelect,
  productService,
} from '@/modules/product';
import { ShopPublicHeader, shopService } from '@/modules/shop';
import { Container } from '@/shared/components/Container';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { ShopChatEntry } from '../../_components/ShopChatEntry';
import { ShopReportEntry } from '../../_components/ShopReportEntry';

interface ShopPublicPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// `generateMetadata` và page cùng cần shop: `cache()` gộp thành một request cho mỗi lượt render (không phụ
// thuộc việc Next có tự khử trùng `fetch` hay không). Route vẫn động (ƒ) — không thêm revalidate: shop vừa
// bị khoá phải biến mất ngay (rules/frontend.md mục 13 — "Trang chủ và /products là dynamic").
const getShop = cache((slug: string) => shopService.getPublicShop(slug));

// Mô tả meta: một dòng, cắt ở 160 ký tự (độ dài các công cụ tìm kiếm thường hiển thị).
const META_DESCRIPTION_MAX = 160;

export async function generateMetadata({ params }: ShopPublicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [shop, t] = await Promise.all([getShop(slug), getTranslations('shop')]);
  // Shop không có/chưa duyệt: page sẽ gọi notFound(); metadata để trống cho khỏi lộ gì thêm.
  if (!shop) return {};

  const singleLine = shop.description?.replace(/\s+/g, ' ').trim();
  return {
    title: shop.name,
    description: singleLine
      ? Array.from(singleLine).slice(0, META_DESCRIPTION_MAX).join('')
      : t('publicMetaDescription', { name: shop.name }),
  };
}

// Server Component — COMPOSITION ROOT của trang shop công khai (rules/frontend.md mục 2): `modules/shop`
// (đầu trang) và `modules/product` (lưới sản phẩm) không được import nhau nên chỉ nơi này biết cả hai và ghép
// bằng props. Đọc `?sort=&page=` qua prop searchParams (không dùng useSearchParams()); chỉ lấy đúng hai param
// này — `q`/`categoryId`/giá trên URL bị bỏ qua, trang này không có bộ lọc đầy đủ.
//
// Lấy shop và sản phẩm SONG SONG: lời gọi tải sản phẩm (theo `shopSlug`) được khởi động TRƯỚC khi `await`
// shop, rồi truyền xuống ProductListResults qua `resultsPromise` — nếu để component con tự gọi lúc render thì
// nó chỉ bắt đầu sau khi shop về (waterfall). `.catch(() => undefined)` đánh dấu promise đã có người xử lý để
// không thành unhandled rejection khi shop 404 làm page ném notFound() trước; lỗi thật vẫn tới
// ProductListResults qua `await` và lên error.tsx.
//
// KHÔNG có `loading.tsx` ở route này: nó làm khung trang được stream đi TRƯỚC khi biết shop có tồn tại không,
// nên shop không tồn tại/chưa duyệt sẽ trả HTTP 200 (soft-404) thay vì 404 — trang công khai nên cần 404 thật.
// Không có loading.tsx thì page `await` shop trước khi gửi bất cứ gì, `notFound()` ra đúng 404; phần lưới sản
// phẩm vẫn có skeleton riêng qua <Suspense> sát dữ liệu (rules/frontend.md mục 10).
export default async function ShopPublicPage({ params, searchParams }: ShopPublicPageProps) {
  const [{ slug }, rawParams, t, tProduct] = await Promise.all([
    params,
    searchParams,
    getTranslations('shop'),
    getTranslations('product'),
  ]);

  const parsed = listProductsQuerySchema.safeParse({
    page: rawParams.page,
    sort: rawParams.sort,
    shopSlug: slug,
  });
  // Param sai dạng (vd page=abc) rơi về mặc định thay vì làm sập trang.
  const query = parsed.success ? parsed.data : listProductsQuerySchema.parse({ shopSlug: slug });

  const resultsPromise = productService.listProducts({
    shopSlug: slug,
    page: query.page,
    limit: query.limit,
    sort: query.sort,
  });
  resultsPromise.catch(() => undefined);

  const shop = await getShop(slug);
  if (!shop) notFound();

  const basePath = `/shops/${encodeURIComponent(shop.slug)}`;

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-6">
          <ShopPublicHeader
            shop={shop}
            chatSlot={<ShopChatEntry shopId={shop.id} />}
            reportSlot={<ShopReportEntry shopId={shop.id} />}
          />

          <section aria-labelledby="shop-products-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="shop-products-title" className="text-base font-semibold text-foreground">
                {t('publicProductsTitle')}
              </h2>
              <ProductSortSelect value={query.sort} basePath={basePath} />
            </div>

            {/* key theo sort+page: Suspense không tự suspend lại khi searchParams đổi trên cùng route (đã
                verify ở /products) — key đổi buộc React coi là instance mới nên fallback hiện lại. Fallback
                cùng hằng số lưới với kết quả thật (HOME_CATALOG_GRID_CLASS) nên không nhảy layout; phần
                hình aria-hidden, vùng bọc aria-busy kèm dòng sr-only đã dịch. */}
            <Suspense
              key={`${query.sort}-${query.page}`}
              fallback={
                <div aria-busy="true" className="flex flex-col gap-4">
                  <span className="sr-only">{tProduct('productsLoadingSrOnly')}</span>
                  <div aria-hidden="true" className="flex flex-col gap-4">
                    <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
                    <ProductGridSkeleton gridClassName={HOME_CATALOG_GRID_CLASS} />
                  </div>
                </div>
              }
            >
              <ProductListResults
                query={query}
                resultsPromise={resultsPromise}
                basePath={basePath}
                gridClassName={HOME_CATALOG_GRID_CLASS}
                emptyMessage={t('publicNoProducts')}
              />
            </Suspense>
          </section>
        </Container>
      </main>
    </div>
  );
}
