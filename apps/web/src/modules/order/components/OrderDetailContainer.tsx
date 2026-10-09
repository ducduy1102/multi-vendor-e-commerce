'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ReviewFormSheet } from '@/modules/review';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';

import { useOrder } from '../hooks/useOrder';
import { useOrderActionFlow } from '../hooks/useOrderActionFlow';
import { useOrderItemReviewFlow } from '../hooks/useOrderItemReviewFlow';
import { getCancelBlockedReasonKey } from '../order-cancel-hint';
import { OrderActionDialogs } from './OrderActionDialogs';
import { OrderActions } from './OrderActions';
import { OrderDetailSkeleton } from './OrderDetailSkeleton';
import { OrderDetailView } from './OrderDetailView';
import { OrderItemReviewAction } from './OrderItemReviewAction';

interface OrderDetailContainerProps {
  // null khi URL không phải id hợp lệ — page.tsx (Server Component) đã kiểm UUID trước khi truyền
  // xuống nên không gọi API với đường dẫn tuỳ ý.
  orderId: string | null;
}

// "Không tìm thấy" dùng chung cho id sai dạng và 404 từ BE: BE trả CÙNG 1 body 404 cho đơn không
// tồn tại lẫn đơn của người khác nên giao diện không thể (và không được) phân biệt 2 trường hợp.
function OrderNotFound() {
  const t = useTranslations('order');

  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-sm text-destructive">
        {t('errorNotFound')}
      </p>
      <Button nativeButton={false} render={<Link href="/orders" />}>
        {t('detailBackToList')}
      </Button>
    </div>
  );
}

function OrderDetailLoader({ orderId }: { orderId: string }) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');

  const orderQuery = useOrder(orderId);
  const flow = useOrderActionFlow();
  const reviewFlow = useOrderItemReviewFlow(orderId);

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá
  // mất đơn đang xem; chỉ báo lỗi khi chưa có gì để hiện.
  const order = orderQuery.data;

  if (!order) {
    if (orderQuery.isPending) {
      return (
        <div aria-busy="true">
          <span className="sr-only">{tCommon('loading')}</span>
          <OrderDetailSkeleton />
        </div>
      );
    }

    if (orderQuery.error instanceof ApiError && orderQuery.error.status === 404) {
      return <OrderNotFound />;
    }

    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('detailLoadError')}
        </p>
        <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
      <OrderDetailView
        order={order}
        actions={
          <OrderActions
            order={order}
            isDisabled={flow.isActionPending}
            cancelBlockedKey={getCancelBlockedReasonKey(order)}
            onCancel={() => flow.openCancelDialog(order)}
            onConfirmReceived={() => flow.openConfirmReceivedDialog(order)}
            onRetryPayment={() => void flow.retryPayment(order)}
          />
        }
        // Cờ canReview/review do BE tính theo từng dòng; dải chỉ hiện khi được phép (đơn COMPLETED...).
        renderItemFooter={(item) => (
          <OrderItemReviewAction
            canReview={item.canReview}
            review={item.review}
            onWrite={() => reviewFlow.openWrite(item)}
            onEdit={() => reviewFlow.openEdit(item)}
          />
        )}
      />
      <OrderActionDialogs {...flow.dialogs} />
      <ReviewFormSheet {...reviewFlow.sheet} />
    </div>
  );
}

// Nối dữ liệu (useOrder + luồng hành động + luồng đánh giá) với UI thuần OrderDetailView. Đủ loading/error/
// 404/thành công (rules/frontend.md mục 10). Container không cần unit test (mục 8) — logic có test ở
// useOrderActionFlow, useOrderItemReviewFlow, getCancelBlockedReasonKey, OrderDetailView, OrderActions,
// OrderItemReviewAction, OrderTimeline.
export function OrderDetailContainer({ orderId }: OrderDetailContainerProps) {
  if (!orderId) {
    return <OrderNotFound />;
  }

  return <OrderDetailLoader orderId={orderId} />;
}
