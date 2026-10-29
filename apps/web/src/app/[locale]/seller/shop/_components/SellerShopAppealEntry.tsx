'use client';

import { ShopAppealSection } from '@/modules/appeal';
import { useMyShop } from '@/modules/shop';

// Điểm vào mục kháng nghị cho trang quản lý shop của chủ shop (Week11.md 4.6) — COMPOSITION ROOT: mục kháng nghị cần biết "shop của
// tôi" (`modules/shop`) nhưng `appeal` là module lá không import `shop` (rules/general.md mục 1), nên nơi duy nhất biết cả hai là
// app/. Dùng chung query `useMyShop` với ShopDashboardContainer (cùng khoá cache) nên không gọi API thêm. Chỉ dựng khi shop ĐANG bị
// khoá: các trạng thái khác không có gì để kháng nghị, và sau khi kháng nghị được chấp nhận (shop APPROVED) kết quả đã tới bằng
// thông báo. Thư mục `_components` là private folder của Next.js.
export function SellerShopAppealEntry() {
  const myShop = useMyShop();
  const shop = myShop.data;

  if (!shop || shop.status !== 'SUSPENDED') return null;
  return <ShopAppealSection shopId={shop.id} />;
}
