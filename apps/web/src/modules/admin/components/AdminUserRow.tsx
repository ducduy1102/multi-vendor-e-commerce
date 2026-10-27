'use client';

import { MailWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_STATUS_DISPLAY, getAdminUserDateInfo } from '../admin-user-display';
import { useFormatAdminDate } from '../hooks/useFormatAdminDate';
import type { AdminUser } from '../types';
import {
  ADMIN_USER_FIELD_LABEL_CLASS,
  ADMIN_USER_GRID_CLASS,
  ADMIN_USER_LINK_FOCUS_CLASS,
  ADMIN_USER_ROW_CLASS,
} from './admin-user-row.constants';
import { AdminToneBadge } from './AdminToneBadge';
import { AdminUserAvatar } from './AdminUserAvatar';
import { AdminUserRoleBadge } from './AdminUserRoleBadge';

interface AdminUserRowProps {
  user: AdminUser;
  // Link mở ngăn chi tiết (`?u=<id>` kèm các bộ lọc hiện tại) — dòng không biết cách dựng URL.
  detailHref: string;
  // Nút hành động (AdminUserActions) do Container truyền vào — dòng không biết mutation nào.
  actions?: ReactNode;
}

// Một dòng người dùng trong bảng: người dùng (avatar + tên là link mở ngăn chi tiết + email), trạng thái (kèm lý do khoá/cấm
// và cảnh báo chưa xác thực email), thời điểm, thao tác. MỘT markup CSS Grid duy nhất: từ `md` là hàng của bảng (cùng template
// cột với AdminUserListHeader), dưới `md` là thẻ xếp dọc. Render <li>: nơi dùng phải bọc trong <ul>. Component THUẦN trình
// bày; mọi chuỗi do người dùng nhập (tên, email, lý do) hiện dạng text (React tự escape).
export function AdminUserRow({ user, detailHref, actions }: AdminUserRowProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatAdminDate();
  const { at, captionKey } = getAdminUserDateInfo(user);

  return (
    <li className={cn(ADMIN_USER_GRID_CLASS, ADMIN_USER_ROW_CLASS)}>
      <div className="flex min-w-0 items-center gap-3">
        <AdminUserAvatar name={user.name} />
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="max-w-full min-w-0 truncate text-sm font-semibold text-foreground">
              <Link
                href={detailHref}
                scroll={false}
                className={cn('rounded-sm hover:underline', ADMIN_USER_LINK_FOCUS_CLASS)}
              >
                {user.name}
              </Link>
            </h2>
            {user.role === 'ADMIN' ? <AdminUserRoleBadge /> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className={ADMIN_USER_FIELD_LABEL_CLASS}>{t('columnStatus')}</span>
        <AdminToneBadge display={ADMIN_USER_STATUS_DISPLAY[user.accountStatus]} />
        {user.statusReason ? (
          // Lý do tối đa 500 ký tự — kẹp 2 dòng cho bảng gọn, đủ nội dung ở `title` khi rê chuột và ở ngăn chi tiết.
          <p
            title={user.statusReason}
            className="line-clamp-2 text-xs break-words text-muted-foreground"
          >
            {t('usersReasonLine', { reason: user.statusReason })}
          </p>
        ) : null}
        {user.isEmailVerified ? null : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MailWarning aria-hidden="true" className="size-3.5 shrink-0" />
            {t('usersEmailUnverified')}
          </p>
        )}
      </div>

      <div className="flex flex-col max-md:flex-row-reverse max-md:items-baseline max-md:justify-end max-md:gap-1.5">
        <span className={ADMIN_USER_FIELD_LABEL_CLASS}>{t('usersColumnDate')}</span>
        <time dateTime={at} className="text-sm text-foreground">
          {formatDate(at)}
        </time>
        <span className="text-xs text-muted-foreground">{tDynamic(captionKey)}</span>
      </div>

      {/* `empty:hidden`: tài khoản không có hành động nào (Quản trị viên, đã tự xoá) thì ô trống không chiếm chỗ. */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden md:justify-end">{actions}</div>
    </li>
  );
}
