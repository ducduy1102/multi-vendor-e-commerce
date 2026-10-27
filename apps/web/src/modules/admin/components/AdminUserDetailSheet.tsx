'use client';

import { Ban, Lock, LockOpen, RotateCw, TriangleAlert, UserX, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { Skeleton } from '@/shared/components/ui/skeleton';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_STATUS_DISPLAY } from '../admin-user-display';
import { describeAdminUserHistoryEntry, type AdminUserHistoryKind } from '../admin-user-history';
import type { AdminUserDetailState } from '../admin-user-detail-state';
import { buildAdminShopsHref } from '../admin-shops-href';
import { useFormatAdminDate } from '../hooks/useFormatAdminDate';
import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminUserDetail } from '../types';
import { ADMIN_USER_LINK_FOCUS_CLASS } from './admin-user-row.constants';
import { AdminShopStatusBadge } from './AdminShopStatusBadge';
import { AdminUserAvatar } from './AdminUserAvatar';
import { AdminUserRoleBadge } from './AdminUserRoleBadge';
import { AdminToneBadge } from './AdminToneBadge';

const SKELETON_CLASS = 'motion-reduce:animate-none';

// Nền + tông icon của từng loại dòng lịch sử: khoá = cảnh báo nhẹ, cấm = nguy hiểm, mở lại = thành công.
const HISTORY_ICON: Record<AdminUserHistoryKind, { Icon: LucideIcon; className: string }> = {
  lock: { Icon: Lock, className: 'bg-warning/15 text-foreground' },
  ban: { Icon: Ban, className: 'bg-destructive/10 text-destructive' },
  unlock: { Icon: LockOpen, className: 'bg-success/10 text-success' },
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function DetailSkeleton() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  return (
    <div aria-busy="true" className="flex flex-1 flex-col">
      <SheetTitle className="sr-only">{t('usersSheetLabel')}</SheetTitle>
      <span className="sr-only">{tCommon('loading')}</span>
      <div aria-hidden="true" className="flex flex-col">
        <div className="flex items-start gap-3 p-4 pr-12">
          <Skeleton className={cn('size-12 rounded-full', SKELETON_CLASS)} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={cn('h-5 w-44 max-w-full', SKELETON_CLASS)} />
            <Skeleton className={cn('h-4 w-56 max-w-full', SKELETON_CLASS)} />
            <Skeleton className={cn('h-5 w-28', SKELETON_CLASS)} />
          </div>
        </div>
        <div className="flex flex-col gap-5 px-4">
          {[
            ['w-24', 4],
            ['w-28', 2],
            ['w-32', 3],
          ].map(([width, rows]) => (
            <div key={width as string} className="flex flex-col gap-2">
              <Skeleton className={cn('h-3', width as string, SKELETON_CLASS)} />
              {Array.from({ length: rows as number }, (_, index) => (
                <Skeleton key={index} className={cn('h-4 w-full', SKELETON_CLASS)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailMessage({
  title,
  body,
  isRetryable,
  onRetry,
}: {
  title: string;
  body: string;
  isRetryable: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('admin');
  const Icon = isRetryable ? TriangleAlert : UserX;

  return (
    <div
      role={isRetryable ? 'alert' : 'status'}
      className="flex flex-1 flex-col items-start gap-3 p-4 pt-14"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex flex-col gap-1">
        <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
        <SheetDescription>{body}</SheetDescription>
      </div>
      {isRetryable ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          {t('retry')}
        </Button>
      ) : (
        <SheetClose render={<Button type="button" variant="outline" />}>
          {t('usersSheetCloseAction')}
        </SheetClose>
      )}
    </div>
  );
}

function DetailBody({ user }: { user: AdminUserDetail }) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatAdminDate();
  const formatDateTime = useFormatAdminDateTime();

  const isBanned = user.accountStatus === 'BANNED';
  const isLocked = isBanned || user.accountStatus === 'SUSPENDED';
  const hasSuspendedShop = user.shops.some((shop) => shop.status === 'SUSPENDED');

  const accountRows: [label: string, value: ReactNode][] = [
    [t('usersFieldJoined'), formatDate(user.createdAt)],
    [t('usersFieldEmail'), user.email],
    [
      t('usersFieldEmailVerified'),
      user.isEmailVerified ? t('usersEmailVerifiedYes') : t('usersEmailVerifiedNo'),
    ],
    [t('usersFieldLocale'), user.locale === 'en' ? t('usersLocaleEn') : t('usersLocaleVi')],
    [
      t('usersFieldOrders'),
      <span key="orders" className="tabular-nums">
        {user.orderCount}
      </span>,
    ],
  ];

  return (
    <>
      <div className="flex items-start gap-3 p-4 pr-12">
        <AdminUserAvatar name={user.name} className="size-12" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="min-w-0">
            <SheetTitle className="[overflow-wrap:anywhere]">{user.name}</SheetTitle>
            <SheetDescription className="[overflow-wrap:anywhere]">{user.email}</SheetDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminToneBadge display={ADMIN_USER_STATUS_DISPLAY[user.accountStatus]} />
            {user.role === 'ADMIN' ? <AdminUserRoleBadge /> : null}
            {user.isEmailVerified ? null : (
              <Badge variant="outline" className="text-muted-foreground">
                {t('usersEmailUnverified')}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-4 pb-4">
        {isLocked ? (
          <section
            aria-label={t('usersSectionCurrentStatus')}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-3',
              isBanned
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-warning/40 bg-warning/10',
            )}
          >
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              {isBanned ? (
                <Ban aria-hidden="true" className="size-4" />
              ) : (
                <Lock aria-hidden="true" className="size-4" />
              )}
              {user.statusChangedAt
                ? t(isBanned ? 'usersSinceBanned' : 'usersSinceSuspended', {
                    date: formatDateTime(user.statusChangedAt),
                  })
                : tDynamic(ADMIN_USER_STATUS_DISPLAY[user.accountStatus].labelKey)}
            </p>
            {user.statusReason ? (
              <p className="text-sm break-words whitespace-pre-line text-foreground/90 [overflow-wrap:anywhere]">
                {user.statusReason}
              </p>
            ) : null}
          </section>
        ) : null}

        <section aria-label={t('usersSectionAccount')} className="flex flex-col gap-2">
          <SectionTitle>{t('usersSectionAccount')}</SectionTitle>
          <dl className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            {accountRows.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground sm:py-1">{label}</dt>
                <dd className="mb-2 min-w-0 text-foreground [overflow-wrap:anywhere] last:mb-0 sm:mb-0 sm:py-1">
                  {value}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>

        <section aria-label={t('usersSectionShops')} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <SectionTitle>{t('usersSectionShops')}</SectionTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('usersShopCount', { count: user.shops.length })}
            </span>
          </div>
          {user.shops.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('usersNoShops')}</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {user.shops.map((shop) => (
                <li key={shop.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{shop.name}</p>
                    <p className="truncate text-xs text-muted-foreground">/{shop.slug}</p>
                  </div>
                  <AdminShopStatusBadge status={shop.status} />
                </li>
              ))}
            </ul>
          )}
          {hasSuspendedShop ? (
            <Link
              href={buildAdminShopsHref({ status: 'SUSPENDED' })}
              className={cn(
                'w-fit rounded-sm text-sm text-primary underline-offset-4 hover:underline',
                ADMIN_USER_LINK_FOCUS_CLASS,
              )}
            >
              {t('usersShopsReviewLink')}
            </Link>
          ) : null}
        </section>

        <section aria-label={t('usersSectionHistory')} className="flex flex-col gap-2">
          <SectionTitle>{t('usersSectionHistory')}</SectionTitle>
          {user.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('usersNoHistory')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {user.history.map((entry) => {
                const display = describeAdminUserHistoryEntry(entry);
                const { Icon, className } = HISTORY_ICON[display.kind];
                return (
                  <li key={entry.id} className="flex gap-3">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full',
                        className,
                      )}
                    >
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                        {tDynamic(display.titleKey)}
                        <span className="font-normal text-muted-foreground">
                          {' · '}
                          {entry.actorName ?? t('usersHistoryUnknownActor')}
                        </span>
                      </p>
                      <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </time>
                      {entry.reason ? (
                        <p
                          title={entry.reason}
                          className="line-clamp-3 text-sm break-words text-foreground/90 [overflow-wrap:anywhere]"
                        >
                          {entry.reason}
                        </p>
                      ) : null}
                      {display.note ? (
                        <p className="text-xs text-muted-foreground">
                          {tDynamic(display.note.key, { count: display.note.count })}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

interface AdminUserDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AdminUserDetailState;
  onRetry: () => void;
  // Nút hành động ở chân ngăn (AdminUserActions layout="sheet") — rỗng thì chân ngăn tự ẩn (`empty:hidden`).
  actions: ReactNode;
}

// Ngăn chi tiết người dùng (Sheet bên phải, mở bằng `?u=<id>` nên đồng bộ URL và nút Back/Forward). Bốn trạng thái: đang tải
// (skeleton), lỗi (thử lại được), không tìm thấy (chỉ đóng được) và dữ liệu. Component THUẦN trình bày: dữ liệu, URL, hành
// động và hộp thoại xác nhận do Container nối. Mọi chuỗi do người dùng nhập (tên, email, lý do) hiện dạng text và bẻ dòng
// (`overflow-wrap: anywhere`) để chuỗi dài không làm ngăn rộng ra.
export function AdminUserDetailSheet({
  open,
  onOpenChange,
  state,
  onRetry,
  actions,
}: AdminUserDetailSheetProps) {
  const t = useTranslations('admin');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {state.status === 'pending' ? <DetailSkeleton /> : null}
        {state.status === 'error' ? (
          <DetailMessage
            title={t('usersSheetErrorTitle')}
            body={t('usersSheetErrorBody')}
            isRetryable
            onRetry={onRetry}
          />
        ) : null}
        {state.status === 'not-found' ? (
          <DetailMessage
            title={t('usersSheetNotFoundTitle')}
            body={t('usersSheetNotFoundBody')}
            isRetryable={false}
            onRetry={onRetry}
          />
        ) : null}
        {state.status === 'success' ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <DetailBody user={state.user} />
            </div>
            <div className="flex gap-2 border-t border-border bg-muted/50 p-4 empty:hidden">
              {actions}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
