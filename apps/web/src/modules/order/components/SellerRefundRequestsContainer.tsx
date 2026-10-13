'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';

import { useSellerOrderActionFlow } from '../hooks/useSellerOrderActionFlow';
import { useSellerRefundRequests } from '../hooks/useSellerRefundRequests';
import { SELLER_ORDERS_PATH } from '../orders-href';
import {
  buildSellerRefundRequestsPagination,
  toRefundRequestStatusParam,
  type SellerRefundRequestFilter,
} from '../refund-requests-href';
import { OrderPagination } from './OrderPagination';
import { SELLER_REFUND_TABLE_CLASS } from './seller-refund-request-row.constants';
import { SellerOrderActionDialogs } from './SellerOrderActionDialogs';
import { SellerRefundRequestRow } from './SellerRefundRequestRow';
import { SellerRefundRequestsHeader } from './SellerRefundRequestsHeader';
import { SellerRefundRequestsSkeleton } from './SellerRefundRequestsSkeleton';
import { SellerRefundRequestTabs } from './SellerRefundRequestTabs';

interface SellerRefundRequestsContainerProps {
  // shopId do page.tsx (composition root) truyền xuống sau khi resolve "shop của tôi" bằng modules/shop — module
  // order không cross-import modules/shop (rules/general.md mục 1).
  shopId: string;
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseSellerRefundRequestsPageQuery).
  filter: SellerRefundRequestFilter;
  page: number;
}

// Nối dữ liệu (useSellerRefundRequests + luồng hành động chung với đơn hàng) với UI thuần. Đủ loading/error/empty/
// danh sách (rules/frontend.md mục 10). Container không cần unit test (mục 8) — phần có logic đã tách ra hàm thuần/
// hook có test (parseSellerRefundRequestsPageQuery, buildSellerRefundRequestsPagination,
// useSellerOrderActionFlow) và component thuần (SellerRefundRequestRow, tab, hộp thoại).
export function SellerRefundRequestsContainer({
  shopId,
  filter,
  page,
}: SellerRefundRequestsContainerProps) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');

  const requestsQuery = useSellerRefundRequests(shopId, {
    status: toRefundRequestStatusParam(filter),
    page,
  });
  const flow = useSellerOrderActionFlow(shopId);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-foreground">{t('refundQueueTitle')}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={SELLER_ORDERS_PATH}
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          {t('sellerOrdersLink')}
        </Link>
        <Link
          href="/seller/products"
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          {t('sellerBackToProducts')}
        </Link>
      </div>
    </div>
  );

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <SellerRefundRequestTabs activeFilter={filter} />
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
    </>
  );

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách
  // đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const data = requestsQuery.data;

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {controls}
        {requestsQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <SellerRefundRequestsSkeleton />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('refundQueueLoadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void requestsQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildSellerRefundRequestsPagination({ filter, page, total, limit });

  return (
    <div className="flex flex-col gap-6">
      {header}
      {controls}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === 'PENDING_SELLER' ? t('refundQueueEmptyPending') : t('refundQueueEmpty')}
        </p>
      ) : (
        <div className={SELLER_REFUND_TABLE_CLASS}>
          <SellerRefundRequestsHeader />
          <ul aria-label={t('refundQueueListLabel')} className="divide-y divide-border">
            {items.map((request) => (
              <SellerRefundRequestRow
                key={request.id}
                request={request}
                isDisabled={flow.isActionPending}
                onApprove={() => flow.openApproveRefundDialog(request)}
                onReject={() => flow.openRejectRefundDialog(request)}
              />
            ))}
          </ul>
        </div>
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
