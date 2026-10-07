'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { ADMIN_SHOP_STATUS_DISPLAY } from '../admin-status-display';
import { buildAdminShopsPagination } from '../admin-shops-href';
import { useAdminShopActionFlow } from '../hooks/useAdminShopActionFlow';
import { useAdminShops } from '../hooks/useAdminShops';
import type { ShopStatus } from '../types';
import { ADMIN_SHOP_TABLE_CLASS } from './admin-shop-row.constants';
import { AdminShopActionDialogs } from './AdminShopActionDialogs';
import { AdminShopActions } from './AdminShopActions';
import { AdminShopListHeader } from './AdminShopListHeader';
import { AdminShopListSkeleton } from './AdminShopListSkeleton';
import { AdminShopPagination } from './AdminShopPagination';
import { AdminShopRow } from './AdminShopRow';
import { AdminShopTabs } from './AdminShopTabs';

interface AdminShopsContainerProps {
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseAdminShopsPageQuery).
  status: ShopStatus;
  page: number;
}

// Nối dữ liệu (useAdminShops + luồng hành động) với UI thuần. Đủ loading/error/empty/danh sách
// (rules/frontend.md mục 10). Container không cần unit test (mục 8) — phần có logic đã tách ra hàm
// thuần/hook có test (parseAdminShopsPageQuery, buildAdminShopsPagination, getAdminShopActions,
// useAdminShopActionFlow) và component thuần (AdminShopRow, AdminShopActions, hộp thoại, tab).
export function AdminShopsContainer({ status, page }: AdminShopsContainerProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const tCommon = useTranslations('common');

  const shopsQuery = useAdminShops({ status, page });
  const flow = useAdminShopActionFlow();

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <AdminShopTabs activeStatus={status} />
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
    </>
  );

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá
  // mất danh sách đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const data = shopsQuery.data;

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {controls}
        {shopsQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <AdminShopListSkeleton status={status} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('loadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void shopsQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildAdminShopsPagination({ status, page, total, limit });

  return (
    <div className="flex flex-col gap-6">
      {controls}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tDynamic(ADMIN_SHOP_STATUS_DISPLAY[status].emptyKey)}
        </p>
      ) : (
        <div className={ADMIN_SHOP_TABLE_CLASS}>
          <AdminShopListHeader status={status} />
          <ul aria-label={t('listLabel')} className="divide-y divide-border">
            {items.map((shop) => (
              <AdminShopRow
                key={shop.id}
                shop={shop}
                actions={
                  <AdminShopActions
                    status={shop.status}
                    shopName={shop.name}
                    isDisabled={flow.isActionPending}
                    onApprove={() => void flow.approve(shop)}
                    onReject={() => flow.openRejectDialog(shop)}
                    onSuspend={() => flow.openSuspendDialog(shop)}
                    onUnsuspend={() => flow.openUnsuspendDialog(shop)}
                  />
                }
              />
            ))}
          </ul>
        </div>
      )}

      <AdminShopPagination
        page={page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />

      <AdminShopActionDialogs {...flow.dialogs} />
    </div>
  );
}
