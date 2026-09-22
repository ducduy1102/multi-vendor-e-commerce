import { Home, LayoutGrid, Shirt, Smartphone, type LucideIcon } from 'lucide-react';

// Slug lấy từ apps/api/prisma/seed.ts (parent category thật, không phải
// bịa) — chỉ map category CẤP CHA vì lưới danh mục trang chủ chỉ hiển thị
// cấp cha (xem get-top-level-categories.ts). Category con (vd "ao-nam",
// "dien-thoai") không cần icon riêng ở đây.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'thoi-trang': Shirt,
  'dien-tu': Smartphone,
  'gia-dung': Home,
};

// Icon dự phòng cho slug lạ (category mới thêm ở seed/DB sau này mà chưa
// kịp map) — không throw, tránh vỡ cả lưới chỉ vì thiếu 1 icon.
export const CATEGORY_FALLBACK_ICON: LucideIcon = LayoutGrid;

export function getCategoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? CATEGORY_FALLBACK_ICON;
}
