import { cn } from '@/shared/lib/utils';

interface CartCountBadgeProps {
  // null (chưa biết) hoặc 0 -> không hiện gì.
  count: number | null;
  className?: string;
}

const MAX_DISPLAY_COUNT = 99;

// Chấm số nhỏ đè góc icon giỏ hàng. Chỉ trang trí (aria-hidden) — số item
// cho trình đọc màn hình nằm ở chữ sr-only của link chứa nó. Dùng màu
// semantic bg-primary (không dùng accent — accent chỉ cho điểm nhấn khuyến
// mãi, không phải chỉ báo số lượng). Cần cha có `relative`.
export function CartCountBadge({ count, className }: CartCountBadgeProps) {
  if (!count || count < 1) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground',
        className,
      )}
    >
      {count > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : count}
    </span>
  );
}
