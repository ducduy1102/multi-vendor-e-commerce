'use client';

import { Link } from '@/i18n/navigation';
import { useSellerChannelLink } from '@/shared/hooks/useSellerChannelLink';

interface SellerChannelLinkProps {
  className?: string;
  children: React.ReactNode;
}

// Mảnh Client Component nhỏ nhất có thể — chỉ để HomeBanner (Server
// Component) vẫn dùng được href động theo trạng thái đăng nhập/shop
// (useSellerChannelLink cần Zustand + TanStack Query, cả 2 đều client-only).
// Chữ hiển thị ("Bán hàng cùng Chốt") cố định qua children do HomeBanner
// truyền vào, không đổi theo trạng thái — chỉ đích đến (href) đổi.
export function SellerChannelLink({ className, children }: SellerChannelLinkProps) {
  const channel = useSellerChannelLink();
  // Đang resolve (đã đăng nhập nhưng useMyShop() chưa xong) — tạm trỏ
  // /seller/onboarding, nhịp này rất ngắn và banner không phải phần tử
  // nhận focus đầu tiên trên trang, chấp nhận được thay vì disable link.
  const href = channel?.href ?? '/seller/onboarding';

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
