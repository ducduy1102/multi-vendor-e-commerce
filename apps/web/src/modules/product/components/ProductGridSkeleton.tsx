import { HOME_PRODUCT_GRID_CLASS } from './HomeCatalog.constants';
import { ProductCardSkeleton } from './ProductCardSkeleton';

interface ProductGridSkeletonProps {
  count: number;
}

// UI thuần — count truyền qua prop (không tự import HOME_PRODUCTS_LIMIT),
// để có thể tái dùng cho số lượng khác nếu cần sau này. Dùng chung đúng
// class lưới (HOME_PRODUCT_GRID_CLASS) với lưới sản phẩm thật trong
// HomeCatalog.tsx — 2 bên không lệch nhau. aria-hidden vì thuần trang trí.
export function ProductGridSkeleton({ count }: ProductGridSkeletonProps) {
  return (
    <div className={HOME_PRODUCT_GRID_CLASS} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}
