import { cn } from '@/shared/lib/utils';

interface CountBadgeProps {
  // null/undefined (chưa biết) hoặc 0 -> không hiện gì.
  count: number | null | undefined;
  className?: string;
}

const MAX_DISPLAY_COUNT = 99;

// Chấm số nhỏ đè góc một icon (giỏ hàng, tin nhắn, về sau là thông báo). Trích từ CartCountBadge khi có nơi dùng thứ
// hai (rules/general.md mục 1: dùng chung ≥ 2 module thì vào shared/). Chỉ trang trí (aria-hidden) — số cho trình đọc
// màn hình nằm ở chữ sr-only của link chứa nó. Màu semantic bg-primary (không dùng accent — accent chỉ cho điểm nhấn
// khuyến mãi, không phải chỉ báo số lượng). Cần cha có `relative`. Dùng inline trong menu thì truyền
// `className="static ml-auto"` để bỏ định vị tuyệt đối.
export function CountBadge({ count, className }: CountBadgeProps) {
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
