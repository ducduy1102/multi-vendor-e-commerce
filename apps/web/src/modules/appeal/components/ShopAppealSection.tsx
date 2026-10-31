'use client';

import { useCreateShopAppeal } from '../hooks/useCreateShopAppeal';
import { useShopAppeals } from '../hooks/useShopAppeals';
import { AppealSection } from './AppealSection';

interface ShopAppealSectionProps {
  shopId: string;
}

// Mục kháng nghị ở trang quản lý shop của chủ shop (Week11.md 4.6). Nơi ghép (`app/.../SellerShopAppealEntry`) chỉ dựng mục này khi shop
// đang bị khoá. Logic giao diện nằm ở `AppealSection` (dùng chung với kháng nghị sản phẩm); đây chỉ nối hook của shop vào.
export function ShopAppealSection({ shopId }: ShopAppealSectionProps) {
  const appealsQuery = useShopAppeals(shopId);
  const createAppeal = useCreateShopAppeal(shopId);

  return <AppealSection kind="shop" appealsQuery={appealsQuery} createAppeal={createAppeal} />;
}
