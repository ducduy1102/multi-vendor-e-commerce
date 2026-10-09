'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';

import { useSellerOrderActionFlow } from '../hooks/useSellerOrderActionFlow';
import { useSellerOrders } from '../hooks/useSellerOrders';
import { SELLER_ORDER_TAB_KEYS } from '../order-status-display';
import { SELLER_ORDERS_PATH, buildOrdersPagination } from '../orders-href';
import type { SellerOrderTab } from '../types';
import { OrderPagination } from './OrderPagination';
import { OrderTabs } from './OrderTabs';
import { SellerOrderActionDialogs } from './SellerOrderActionDialogs';
import { SellerOrderActions } from './SellerOrderActions';
import { SellerOrderCard } from './SellerOrderCard';
import { SellerOrderListSkeleton } from './SellerOrderListSkeleton';

interface SellerOrdersContainerProps {
  // shopId do page.tsx (composition root) truyền xuống sau khi resolve "shop của tôi" bằng
  // modules/shop — module order không cross-import modules/shop (rules/general.md mục 1).
  shopId: string;
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseSellerOrdersPageQuery).
  tab?: SellerOrderTab;
  page: number;
}

// Nối dữ liệu (useSellerOrders + luồng hành động) với UI thuần. Đủ loading/error/empty/danh sách
// (rules/frontend.md mục 10). Container không cần unit test (mục 8) — phần có logic đã tách ra hàm
// thuần/hook có test (parseSellerOrdersPageQuery, buildOrdersPagination, useSellerOrderActionFlow)
// và component thuần (SellerOrderCard, SellerOrderActions, hộp thoại, OrderTabs).
export function SellerOrdersContainer({ shopId, tab, page }: SellerOrdersContainerProps) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');

  const ordersQuery = useSellerOrders(shopId, { tab, page });
  const flow = useSellerOrderActionFlow(shopId);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-foreground">{t('sellerPageTitle')}</h1>
      <Link
        href="/seller/products"
        className="shrink-0 text-sm font-medium text-foreground hover:underline"
      >
        {t('sellerBackToProducts')}
      </Link>
    </div>
  );

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <OrderTabs activeTab={tab} tabs={SELLER_ORDER_TAB_KEYS} basePath={SELLER_ORDERS_PATH} />
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
    </>
  );

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá
  // mất danh sách đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const data = ordersQuery.data;

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {controls}
        {ordersQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <SellerOrderListSkeleton />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('sellerLoadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void ordersQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildOrdersPagination({
    tab,
    page,
    total,
    limit,
    basePath: SELLER_ORDERS_PATH,
  });

  return (
    <div className="flex flex-col gap-6">
      {header}
      {controls}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab ? t('sellerEmptyStateTab') : t('sellerEmptyState')}
        </p>
      ) : (
        <ul aria-label={t('sellerListLabel')} className="flex flex-col gap-3">
          {items.map((order) => (
            <li key={order.id}>
              <SellerOrderCard
                order={order}
                actions={
                  <SellerOrderActions
                    order={order}
                    isDisabled={flow.isActionPending}
                    onConfirm={() => void flow.confirm(order)}
                    onPack={() => void flow.pack(order)}
                    onShip={() => flow.openShipDialog(order)}
                    onReject={() => flow.openRejectDialog(order)}
                    onCancel={() => flow.openCancelDialog(order)}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}

      <OrderPagination
        page={page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />

      <SellerOrderActionDialogs {...flow.dialogs} />
    </div>
  );
}
