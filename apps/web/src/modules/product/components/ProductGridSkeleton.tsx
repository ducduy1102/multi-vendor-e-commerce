import { HOME_PRODUCT_GRID_CLASS } from './HomeCatalog.constants';
import { ProductCardSkeleton } from './ProductCardSkeleton';

// Khớp `limit` mặc định của listProductsQuerySchema (@ecommerce/types) —
// dùng khi gọi ProductGridSkeleton không truyền `count` (vd fallback
// <Suspense> của /products, chưa biết `total`/`limit` thật vì chưa fetch
// xong).
const DEFAULT_SKELETON_COUNT = 12;

interface ProductGridSkeletonProps {
  count?: number;
  // Mặc định HOME_PRODUCT_GRID_CLASS (giữ nguyên hành vi cũ cho
  // HomeCatalogSkeleton) — /products truyền PRODUCTS_PAGE_GRID_CLASS riêng
  // vì có sidebar filter chiếm chỗ, số cột khác trang chủ.
  gridClassName?: string;
}

// UI thuần — count truyền qua prop (không tự import HOME_PRODUCTS_LIMIT),
// để có thể tái dùng cho số lượng khác nếu cần sau này. aria-hidden vì
// thuần trang trí.
export function ProductGridSkeleton({
  count = DEFAULT_SKELETON_COUNT,
  gridClassName = HOME_PRODUCT_GRID_CLASS,
}: ProductGridSkeletonProps) {
  return (
    <div className={gridClassName} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}
