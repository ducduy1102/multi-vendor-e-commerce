import { cn } from './utils';

// Kiểu một tab dạng link (đổi `?param=` trên URL) — dùng chung giữa các hàng tab của khu seller (tab đơn hàng,
// hàng chờ yêu cầu hủy/trả hàng ở modules/order, tab lọc đánh giá ở modules/review) để chúng không lệch nhau.
// Nằm ở shared/ vì ≥ 2 module dùng và hai module đó không được import nhau.
export function getTabLinkClass(isActive: boolean): string {
  return cn(
    '-mb-px inline-flex min-h-11 items-center rounded-t-md border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    isActive
      ? 'border-primary text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );
}
