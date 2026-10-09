'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';

import { useOrderActionFlow } from '../hooks/useOrderActionFlow';
import { useOrders } from '../hooks/useOrders';
import { buildOrdersPagination } from '../orders-href';
import type { OrderTab } from '../types';
import { OrderActionDialogs } from './OrderActionDialogs';
import { OrderActions } from './OrderActions';
import { OrderCard } from './OrderCard';
import { OrderListSkeleton } from './OrderListSkeleton';
import { OrderPagination } from './OrderPagination';
import { OrderRefundStatusLine } from './OrderRefundStatusLine';
import { OrderTabs } from './OrderTabs';

interface OrdersContainerProps {
  // Đã được page.tsx (Server Component) đọc + chuẩn hoá từ searchParams (parseOrdersPageQuery).
  tab?: OrderTab;
  page: number;
}

// Nối dữ liệu (useOrders + luồng hành động) với UI thuần. Đủ loading/error/empty/danh sách
// (rules/frontend.md mục 10). Container không cần unit test (mục 8) — phần có logic đã tách ra hàm
// thuần/hook có test (buildOrdersPagination, parseOrdersPageQuery, useOrderActionFlow) và component
// thuần (OrderCard, OrderActions, hộp thoại, OrderTabs, OrderPagination).
export function OrdersContainer({ tab, page }: OrdersContainerProps) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');
  const tHome = useTranslations('home');

  const ordersQuery = useOrders({ tab, page });
  const flow = useOrderActionFlow();

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <OrderTabs activeTab={tab} />
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
    </>
  );

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá
  // mất danh sách đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const data = ordersQuery.data;

  if (!data) {
    if (ordersQuery.isPending) {
      return (
        <div className="flex flex-col gap-4">
          {controls}
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <OrderListSkeleton />
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {controls}
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {t('loadError')}
          </p>
          <Button type="button" variant="outline" onClick={() => void ordersQuery.refetch()}>
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildOrdersPagination({ tab, page, total, limit });

  return (
    <div className="flex flex-col gap-4">
      {controls}

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            {tab ? t('emptyStateTab') : t('emptyState')}
          </p>
          {tab ? null : (
            <Button nativeButton={false} render={<Link href="/products" />}>
              {tHome('bannerCta')}
            </Button>
          )}
        </div>
      ) : (
        <ul aria-label={t('listLabel')} className="flex flex-col gap-3">
          {items.map((order) => (
            <li key={order.id}>
              <OrderCard
                order={order}
                actions={
                  <>
                    {/* Có yêu cầu hủy/trả hàng thì cờ gửi yêu cầu tắt, card không còn nút — dòng này cho biết
                        trạng thái; rút/khiếu nại ở trang chi tiết. */}
                    <OrderRefundStatusLine request={order.refundRequest} />
                    <OrderActions
                      order={order}
                      isDisabled={flow.isActionPending}
                      onCancel={() => flow.openCancelDialog(order)}
                      onRequestCancel={() => flow.openRequestRefundDialog(order, 'CANCEL')}
                      onRequestReturn={() => flow.openRequestRefundDialog(order, 'RETURN')}
                      onConfirmReceived={() => flow.openConfirmReceivedDialog(order)}
                      onRetryPayment={() => void flow.retryPayment(order)}
                    />
                  </>
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

      <OrderActionDialogs {...flow.dialogs} />
    </div>
  );
}
