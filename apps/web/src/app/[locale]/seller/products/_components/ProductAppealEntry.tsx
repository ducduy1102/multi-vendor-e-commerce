'use client';

import { ProductAppealSection } from '@/modules/appeal';
import { useMyShop } from '@/modules/shop';

interface ProductAppealEntryProps {
  productId: string;
}

// Điểm vào mục kháng nghị cho trang sửa sản phẩm bị gỡ (Week11.md 5.8) — COMPOSITION ROOT: mục kháng nghị cần biết "shop của tôi"
// (`modules/shop`) để gọi đúng API `/shops/:shopId/products/:productId/appeals`, nhưng `appeal` là module lá không import `shop` (và
// `product` không import `appeal`; rules/general.md mục 1), nên nơi duy nhất biết cả ba là app/. Dùng chung query `useMyShop` với các trang
// seller khác (cùng khoá cache) nên không gọi API thêm. Chỉ được `EditProductFormContainer` dựng khi sản phẩm ĐANG bị gỡ. Chưa biết shop
// (đang tải / lỗi) thì chưa vẽ gì — thông báo "Sản phẩm đã bị gỡ" kèm lý do vẫn hiện đầy đủ. Thư mục `_components` là private folder của Next.js.
export function ProductAppealEntry({ productId }: ProductAppealEntryProps) {
  const myShop = useMyShop();
  const shop = myShop.data;

  if (!shop) return null;
  return <ProductAppealSection shopId={shop.id} productId={productId} />;
}
