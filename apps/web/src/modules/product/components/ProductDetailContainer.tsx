import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { WishlistButton } from '@/modules/wishlist';
import { ApiError } from '@/shared/lib/api-client';
import * as productService from '../services/product.service';
import { PRODUCT_DETAIL_LAYOUT_CLASS } from './ProductDetail.constants';
import { ProductGallery } from './ProductGallery';
import { ProductVariantSection } from './ProductVariantSection';
import { VariantSelectionProvider } from './VariantSelectionContext';

interface ProductDetailContainerProps {
  slug: string;
}

// Server Component async (Suspense-wrapped ở page.tsx) — SSR fetch qua slug,
// đúng rules/frontend.md mục 2 (data fetch ban đầu ở Server Component, không
// TanStack Query cho lần fetch đầu). Giá + chọn variant (Bước 3.2) và gallery
// đổi ảnh theo variant (Bước 3.3) đều cần đọc chung `selectedValues` dù nằm
// ở 2 cell lưới khác nhau (không lồng nhau) — bọc `VariantSelectionProvider`
// (Client Component) quanh CẢ layout, nhưng h1/dl/mô tả bên dưới vẫn là JSX
// viết trực tiếp ở đây (Server Component), không bị kéo vào client bundle vì
// chỉ truyền qua như `children`, không import vào file Provider (xem
// VariantSelectionContext.tsx). `WishlistButton` (Bước 3.4) import từ
// modules/wishlist qua barrel — component tự chứa (tự gọi API/quản lý state
// riêng), đúng ngoại lệ cross-import UI tái dùng được ở rules/frontend.md
// mục 1 (giống ResendVerificationButton/useAuthStore dùng lại ở modules/shop).
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

  return (
    <VariantSelectionProvider>
      <div className={PRODUCT_DETAIL_LAYOUT_CLASS}>
        <ProductGallery variants={product.variants} productName={product.name} />

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-semibold text-foreground">{product.name}</h1>
            <WishlistButton productId={product.id} />
          </div>

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
    </VariantSelectionProvider>
  );
}
