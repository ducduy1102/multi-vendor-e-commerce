import { ImageOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { ApiError } from '@/shared/lib/api-client';
import * as productService from '../services/product.service';
import { PRODUCT_DETAIL_LAYOUT_CLASS } from './ProductDetail.constants';
import { ProductVariantSection } from './ProductVariantSection';

interface ProductDetailContainerProps {
  slug: string;
}

// Server Component async (Suspense-wrapped ở page.tsx) — SSR fetch qua slug,
// đúng rules/frontend.md mục 2 (data fetch ban đầu ở Server Component, không
// TanStack Query cho lần fetch đầu). Giá + chọn variant (Week5.md Bước 3.2)
// tách sang `ProductVariantSection` (Client Component, cần state) — gallery
// nhiều ảnh (Bước 3.3) và nút wishlist (Bước 3.4) ghép thêm vào layout này ở
// các bước sau.
export async function ProductDetailContainer({ slug }: ProductDetailContainerProps) {
  let product;
  try {
    product = await productService.getProductBySlug(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [t, categories] = await Promise.all([
    getTranslations('product'),
    productService.getCategories(),
  ]);
  const categoryName = categories.find((category) => category.id === product.categoryId)?.name;
  const coverImageUrl = product.variants[0]?.images[0]?.url;

  return (
    <div className={PRODUCT_DETAIL_LAYOUT_CLASS}>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center" aria-hidden="true">
            <ImageOff className="size-12 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">{product.name}</h1>

        <ProductVariantSection
          attributes={product.attributes}
          variants={product.variants}
          minPrice={product.minPrice}
          maxPrice={product.maxPrice}
        />

        <dl className="flex flex-col gap-1 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt>{t('detailShopLabel')}:</dt>
            <dd className="text-foreground">{product.shop.name}</dd>
          </div>
          {categoryName ? (
            <div className="flex gap-1">
              <dt>{t('filterCategoryLabel')}:</dt>
              <dd className="text-foreground">{categoryName}</dd>
            </div>
          ) : null}
        </dl>

        <p className="whitespace-pre-line text-sm text-foreground">
          {product.description || t('detailNoDescription')}
        </p>
      </div>
    </div>
  );
}
