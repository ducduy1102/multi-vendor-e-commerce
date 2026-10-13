import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ProductDetailContainer, ProductDetailSkeleton, productService } from '@/modules/product';
import { parseReviewPageQuery } from '@/modules/review';
import { Container } from '@/shared/components/Container';
import { ApiError } from '@/shared/lib/api-client';

interface ProductDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// generateMetadata() và ProductDetailPage() là 2 hàm Next.js gọi riêng,
// không chia sẻ state (giống LocaleLayout, xem app/[locale]/layout.tsx) —
// mỗi hàm tự fetch + tự xử lý 404 (notFound()) độc lập. Cả 2 gọi cùng
// getProductBySlug(slug) với cùng URL/options nên Next.js tự dedupe (Request
// Memoization), không tốn 2 lần round-trip thật tới BE.
export async function generateMetadata({ params }: ProductDetailPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const product = await productService.getProductBySlug(slug);
    return {
      title: product.name,
      description: product.description ?? undefined,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

// Server Component — SSR fetch qua slug (rules/frontend.md mục 2). Nội dung
// chính (ProductDetailContainer) đặt sau Suspense để route chuyển trang tức
// thì (hiện skeleton) thay vì chặn cả trang chờ fetch xong, đúng
// rules/frontend.md mục 10 (loading dùng Suspense đặt sát phần dữ liệu).
export default async function ProductDetailPage({ params, searchParams }: ProductDetailPageProps) {
  const [{ slug }, rawSearchParams] = await Promise.all([params, searchParams]);
  // Bộ lọc sao + trang của khối đánh giá (`?reviewRating=&reviewPage=`). page.tsx là composition root: biết cả
  // modules/product lẫn modules/review và ghép chúng bằng props (rules/frontend.md mục 2) — modules/review
  // không bị product kéo vào để đọc URL.
  const reviewQuery = parseReviewPageQuery(rawSearchParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col py-6">
          <Suspense key={slug} fallback={<ProductDetailSkeleton />}>
            <ProductDetailContainer slug={slug} reviewQuery={reviewQuery} />
          </Suspense>
        </Container>
      </main>
    </div>
  );
}
