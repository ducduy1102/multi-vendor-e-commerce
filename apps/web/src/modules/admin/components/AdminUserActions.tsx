'use client';

import { Ban, Ellipsis, Lock, LockOpen, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { getAdminUserActions, type AdminUserAction } from '../admin-user-actions';
import type { AdminUser } from '../types';

const ACTION_META = {
  suspend: { labelKey: 'usersActionSuspend', Icon: Lock },
  reactivate: { labelKey: 'usersActionReactivate', Icon: LockOpen },
  unban: { labelKey: 'usersActionUnban', Icon: LockOpen },
  ban: { labelKey: 'usersActionBan', Icon: Ban },
} as const satisfies Record<AdminUserAction, { labelKey: string; Icon: LucideIcon }>;

interface AdminUserActionsProps {
  user: Pick<AdminUser, 'name' | 'role' | 'accountStatus'>;
  // `row`: nút thường dùng ngay trên dòng + menu `…` cho hành động nặng. `sheet`: mọi hành động là nút rộng ở chân ngăn chi
  // tiết (ngăn có chỗ, và người đang đọc kỹ một tài khoản không phải tìm trong menu).
  layout?: 'row' | 'sheet';
  // Khoá mọi nút khi một hành động đang chạy (tránh gửi trùng / hai hành động chồng nhau).
  isDisabled: boolean;
  onAction: (action: AdminUserAction) => void;
}

// Component THUẦN: hiện nút theo trạng thái hiện tại (getAdminUserActions — suy từ bảng chuyển trạng thái dùng chung với BE,
// nên không bao giờ hiện hành động BE sẽ từ chối) và gọi callback; hộp thoại, mutation, xử lý lỗi nằm ở Container. Hành động
// thường dùng (Khoá / Mở lại / Gỡ cấm) là nút outline trung tính; Cấm — mức nặng nhất — nằm trong menu `…` với màu cảnh báo,
// màu đỏ chỉ xuất hiện ở đó và ở nút xác nhận trong hộp thoại, accent cam không dùng cho nút nguy hiểm. Không có hành động nào
// (Quản trị viên, tài khoản đã tự xoá) thì không vẽ gì.
export function AdminUserActions({
  user,
  layout = 'row',
  isDisabled,
  onAction,
}: AdminUserActionsProps) {
  const t = useTranslations('admin');
  const { primary, more } = getAdminUserActions(user);

  if (!primary && more.length === 0) {
    return null;
  }

  const label = (action: AdminUserAction) =>
    t('usersActionLabelWithUser', { action: t(ACTION_META[action].labelKey), name: user.name });

  if (layout === 'sheet') {
    return (
      <>
        {primary ? (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={isDisabled}
            aria-label={label(primary)}
            onClick={() => onAction(primary)}
          >
            {renderIcon(primary)}
            {t(ACTION_META[primary].labelKey)}
          </Button>
        ) : null}
        {more.map((action) => (
          <Button
            key={action}
            type="button"
            variant="destructive"
            className="flex-1"
            disabled={isDisabled}
            aria-label={label(action)}
            onClick={() => onAction(action)}
          >
            {renderIcon(action)}
            {t(ACTION_META[action].labelKey)}
          </Button>
        ))}
      </>
    );
  }

  return (
    <>
      {primary ? (
        <Button
          type="button"
          variant="outline"
          disabled={isDisabled}
          aria-label={label(primary)}
          onClick={() => onAction(primary)}
        >
          {renderIcon(primary)}
          {t(ACTION_META[primary].labelKey)}
        </Button>
      ) : null}

      {more.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isDisabled}
                aria-label={t('usersActionMore', { name: user.name })}
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            {more.map((action) => (
              <DropdownMenuItem key={action} variant="destructive" onClick={() => onAction(action)}>
                {renderIcon(action)}
                {t(ACTION_META[action].labelKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        // Giữ chỗ của nút `…` để nút chính của dòng không có menu (đã bị cấm) vẫn thẳng cột với các dòng khác.
        <span aria-hidden="true" className="hidden size-8 md:block" />
      )}
    </>
  );
}

function renderIcon(action: AdminUserAction) {
  const { Icon } = ACTION_META[action];
  return <Icon aria-hidden="true" data-icon="inline-start" />;
}
