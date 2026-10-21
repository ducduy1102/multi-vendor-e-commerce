import { CountBadge } from '@/shared/components/CountBadge';

interface CartCountBadgeProps {
  // null (chưa biết) hoặc 0 -> không hiện gì.
  count: number | null;
  className?: string;
}

// Vỏ mỏng của CountBadge dùng chung (shared/components/CountBadge.tsx — trích ra khi chat cần cùng chấm số ở Header,
// Week10.md 5.5). Giữ tên và chữ ký cũ để barrel `modules/cart` và nơi dùng (Header, BottomTabBar) không đổi.
export function CartCountBadge({ count, className }: CartCountBadgeProps) {
  return <CountBadge count={count} className={className} />;
}
