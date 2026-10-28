'use client';

import { Ban, Ellipsis, Lock, LockOpen, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { getAdminUserActions, type AdminUserAction } from '../admin-user-actions';
import type { AdminUser } from '../types';
import { ADMIN_CAUTION_BUTTON_CLASS } from './admin-caution-button.constants';

const ACTION_META = {
  suspend: { labelKey: 'usersActionSuspend', Icon: Lock },
  reactivate: { labelKey: 'usersActionReactivate', Icon: LockOpen },
  unban: { labelKey: 'usersActionUnban', Icon: LockOpen },
  ban: { labelKey: 'usersActionBan', Icon: Ban },
} as const satisfies Record<AdminUserAction, { labelKey: string; Icon: LucideIcon }>;

// Cùng phân cấp với bảng duyệt shop: hành động HỒI PHỤC (đưa tài khoản về hoạt động) là nút chính — nút đặc, như "Duyệt"/"Mở
// khoá" ở shop; hành động tiêu cực (khoá, cấm) dùng kiểu cảnh báo chung của khu Admin (viền + chữ `--destructive`, ADMIN_CAUTION_
// BUTTON_CLASS).
const PRIMARY_ACTIONS: ReadonlySet<AdminUserAction> = new Set(['reactivate', 'unban']);
const CAUTION_ACTIONS: ReadonlySet<AdminUserAction> = new Set(['suspend', 'ban']);

const buttonVariant = (action: AdminUserAction) =>
  PRIMARY_ACTIONS.has(action) ? 'default' : 'outline';
const cautionClass = (action: AdminUserAction) =>
  CAUTION_ACTIONS.has(action) ? ADMIN_CAUTION_BUTTON_CLASS : undefined;

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
// thường dùng ở dòng: Khoá là nút viền cảnh báo, Mở lại / Gỡ cấm là nút đặc; Cấm — mức nặng nhất — nằm trong menu `…` với màu
// cảnh báo (ở chân ngăn chi tiết là nút viền cảnh báo như Khoá). Accent cam không dùng cho nút nguy hiểm. Không có hành động nào
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
            variant={buttonVariant(primary)}
            className={cn('flex-1', cautionClass(primary))}
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
            variant={buttonVariant(action)}
            className={cn('flex-1', cautionClass(action))}
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
          variant={buttonVariant(primary)}
          className={cautionClass(primary)}
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
