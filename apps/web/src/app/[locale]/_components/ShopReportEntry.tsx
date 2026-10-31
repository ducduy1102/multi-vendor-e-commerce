'use client';

import { useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';

import { ReportEntry } from './ReportEntry';

interface ShopReportEntryProps {
  shopId: string;
}

// "Báo cáo shop" ở trang shop công khai (Week11.md 5.6) — COMPOSITION ROOT: chủ shop không được báo cáo shop của chính mình nên nút bị
// ẩn khi "shop của tôi" chính là shop này (cần `modules/shop`, mà module `report` là lá không được biết). Cùng cách `ShopChatEntry`
// ẩn nút chat. Khách vãng lai không gọi `useMyShop`. Đang chờ biết kết quả thì chưa vẽ gì (khác nút chat: ở đây nút là phụ, nên không
// giữ chỗ — chỗ trống nhỏ hơn việc nháy nút rồi biến mất ở chủ shop). Lỗi tải "shop của tôi" ⇒ vẫn hiện nút: BE chặn bằng 409.
export function ShopReportEntry({ shopId }: ShopReportEntryProps) {
  const user = useAuthStore((state) => state.user);
  const myShop = useMyShop({ enabled: user !== null });

  if (user !== null && myShop.isPending) return null;
  if (myShop.data?.id === shopId) return null;

  return <ReportEntry targetType="SHOP" targetId={shopId} variant="outline" />;
}
