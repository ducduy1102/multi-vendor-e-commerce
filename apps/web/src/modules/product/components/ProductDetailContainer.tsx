import { ImageOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { ApiError } from '@/shared/lib/api-client';
import { formatPrice } from '../format-price';
import * as productService from '../services/product.service';
import { PRODUCT_DETAIL_LAYOUT_CLASS } from './ProductDetail.constants';

interface ProductDetailContainerProps {
  slug: string;
}

// Server Component async (Suspense-wrapped ở page.tsx) — SSR fetch qua slug,
// đúng rules/frontend.md mục 2 (data fetch ban đầu ở Server Component, không
// TanStack Query cho lần fetch đầu). Component/hook cho VariantSelector
// (Week5.md Bước 3.2), gallery nhiều ảnh (Bước 3.3) và nút wishlist (Bước
// 3.4) sẽ ghép thêm vào layout này ở các bước sau — 3.1 chỉ dựng khung +
// thông tin cơ bản (ảnh đơn variant đầu tiên, khoảng giá, tên shop/danh mục,
// mô tả).
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

  const priceLabel =
    product.minPrice === product.maxPrice
      ? formatPrice(product.minPrice)
      : `${formatPrice(product.minPrice)} - ${formatPrice(product.maxPrice)}`;
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
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{product.name}</h1>
          <p className="text-lg font-semibold text-foreground">{priceLabel}</p>
        </div>

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
