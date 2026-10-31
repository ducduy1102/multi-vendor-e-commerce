'use client';

import { useCreateProductAppeal } from '../hooks/useCreateProductAppeal';
import { useProductAppeals } from '../hooks/useProductAppeals';
import { AppealSection } from './AppealSection';

interface ProductAppealSectionProps {
  shopId: string;
  productId: string;
}

// Mục kháng nghị đầy đủ của MỘT sản phẩm bị gỡ, đặt ở trang sửa sản phẩm của chủ shop (Week11.md 5.8): nút gửi (chỉ khi SERVER báo
// `canAppeal`) + lịch sử kèm phản hồi từ sàn. Nơi ghép (`app/.../ProductAppealEntry`) chỉ dựng mục này khi sản phẩm đang bị gỡ — module
// `appeal` không biết trạng thái sản phẩm (không import `product`).
export function ProductAppealSection({ shopId, productId }: ProductAppealSectionProps) {
  const appealsQuery = useProductAppeals(shopId, productId);
  const createAppeal = useCreateProductAppeal(shopId, productId);

  return <AppealSection kind="product" appealsQuery={appealsQuery} createAppeal={createAppeal} />;
}
