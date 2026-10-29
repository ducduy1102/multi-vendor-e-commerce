import { cn } from '@/shared/lib/utils';

import { getUserInitial } from '../admin-user-display';

interface AdminUserAvatarProps {
  name: string;
  className?: string;
}

// Avatar chữ cái đầu (chưa có ảnh đại diện — xem quyết định "UserAvatar chữ cái đầu viết tay" ở rules/frontend.md). Chỉ trang
// trí (tên đã có ngay bên cạnh) nên `aria-hidden`.
export function AdminUserAvatar({ name, className }: AdminUserAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary',
        className,
      )}
    >
      {getUserInitial(name)}
    </span>
  );
}
