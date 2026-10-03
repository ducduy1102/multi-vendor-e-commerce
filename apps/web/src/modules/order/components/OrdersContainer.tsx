'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useCancelOrder } from '../hooks/useCancelOrder';
import { useConfirmReceived } from '../hooks/useConfirmReceived';
import { useOrders } from '../hooks/useOrders';
import { useRetryOrderPayment } from '../hooks/useRetryOrderPayment';
import { buildOrdersPagination } from '../orders-href';
import { redirectToPaymentGateway } from '../redirect-to-payment-gateway';
import type { OrderListItem, OrderTab } from '../types';
import { CancelOrderDialog } from './CancelOrderDialog';
import { ConfirmReceivedDialog } from './ConfirmReceivedDialog';
import { OrderActions } from './OrderActions';
import { OrderCard } from './OrderCard';
import { OrderListSkeleton } from './OrderListSkeleton';
import { OrderPagination } from './OrderPagination';
import { OrderTabs } from './OrderTabs';

interface OrdersContainerProps {
  // Đã được page.tsx (Server Component) đọc + chuẩn hoá từ searchParams (parseOrdersPageQuery).
  tab?: OrderTab;
  page: number;
}

type DialogKind = 'cancel' | 'confirmReceived';

// Nối dữ liệu (useOrders + 3 mutation) với UI thuần. Đủ loading/error/empty/danh sách
// (rules/frontend.md mục 10). Container không cần unit test (mục 8) — phần có logic đã tách ra hàm
// thuần có test (buildOrdersPagination, parseOrdersPageQuery) và component thuần (OrderCard,
// OrderActions, hộp thoại, OrderTabs, OrderPagination).
export function OrdersContainer({ tab, page }: OrdersContainerProps) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');
  const tHome = useTranslations('home');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  const ordersQuery = useOrders({ tab, page });
  const cancelOrder = useCancelOrder();
  const confirmReceived = useConfirmReceived();
  const retryPayment = useRetryOrderPayment();

  // Giữ cả `order` lẫn cờ mở riêng: đóng hộp thoại chỉ tắt cờ, không xoá đơn — nếu xoá ngay thì
  // nội dung hộp thoại (vd đoạn cảnh báo hủy cả nhóm) đổi giữa chừng lúc đang chạy hiệu ứng đóng.
  const [dialog, setDialog] = useState<{ kind: DialogKind; order: OrderListItem } | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Sau khi có paymentUrl, trình duyệt đang chuyển sang cổng: giữ nút khoá tới khi rời trang.
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isActionPending =
    cancelOrder.isPending || confirmReceived.isPending || retryPayment.isPending || isRedirecting;

  function describeError(error: unknown): string {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  }

  function openDialog(kind: DialogKind, order: OrderListItem) {
    setActionError(null);
    setDialog({ kind, order });
    setIsDialogOpen(true);
  }

  // Đang gửi yêu cầu thì không cho đóng (Esc/bấm nền) — hộp thoại đóng khi yêu cầu xong.
  function handleDialogOpenChange(open: boolean) {
    if (!open && isActionPending) return;
    setIsDialogOpen(open);
  }

  async function handleCancel(order: OrderListItem, reason: string | undefined) {
    try {
      await cancelOrder.mutateAsync({ orderId: order.id, reason });
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setIsDialogOpen(false);
    }
  }

  async function handleConfirmReceived(order: OrderListItem) {
    try {
      await confirmReceived.mutateAsync(order.id);
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setIsDialogOpen(false);
    }
  }

  async function handleRetryPayment(order: OrderListItem) {
    setActionError(null);
    try {
      // Thanh toán gắn theo NHÓM (1 Payment cho N đơn) nên gọi theo checkoutGroupId của đơn.
      const result = await retryPayment.mutateAsync(order.checkoutGroupId);
      setIsRedirecting(true);
      redirectToPaymentGateway(result.paymentUrl);
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  // Tab + thông báo lỗi hành động luôn hiện, dù danh sách đang tải/lỗi/rỗng.
  const controls = (
    <>
      <OrderTabs activeTab={tab} />
      {actionError ? <Alert variant="destructive">{actionError}</Alert> : null}
    </>
  );

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

  if (ordersQuery.isError) {
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

  const { items, total, limit } = ordersQuery.data;
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
                  <OrderActions
                    order={order}
                    isDisabled={isActionPending}
                    onCancel={() => openDialog('cancel', order)}
                    onConfirmReceived={() => openDialog('confirmReceived', order)}
                    onRetryPayment={() => void handleRetryPayment(order)}
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

      {dialog ? (
        <>
          <CancelOrderDialog
            open={isDialogOpen && dialog.kind === 'cancel'}
            onOpenChange={handleDialogOpenChange}
            isGroupCancel={dialog.order.status === 'AWAITING_PAYMENT'}
            isPending={cancelOrder.isPending}
            onConfirm={(reason) => void handleCancel(dialog.order, reason)}
          />
          <ConfirmReceivedDialog
            open={isDialogOpen && dialog.kind === 'confirmReceived'}
            onOpenChange={handleDialogOpenChange}
            isPending={confirmReceived.isPending}
            onConfirm={() => void handleConfirmReceived(dialog.order)}
          />
        </>
      ) : null}
    </div>
  );
}
