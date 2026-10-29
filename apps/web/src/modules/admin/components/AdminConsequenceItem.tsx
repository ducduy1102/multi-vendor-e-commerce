import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

interface AdminConsequenceItemProps {
  Icon: LucideIcon;
  children: ReactNode;
  className?: string;
}

// Một dòng "hệ quả" trong hộp thoại xác nhận của Admin (đăng xuất ngay, shop tạm ngừng, email gửi đi...): icon nhỏ + câu đầy đủ.
// Render <li>: nơi dùng bọc trong <ul aria-label>. Chuỗi do người dùng nhập có thể chen vào (tên, lý do) nên bẻ dòng bằng
// `overflow-wrap: anywhere` để không làm hộp thoại rộng ra.
export function AdminConsequenceItem({ Icon, children, className }: AdminConsequenceItemProps) {
  return (
    <li className={cn('flex items-start gap-2.5 text-sm', className)}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
      </span>
      <span className="min-w-0 text-foreground/90 [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}
