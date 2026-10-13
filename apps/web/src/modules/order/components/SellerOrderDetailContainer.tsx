'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';

import { useSellerOrder } from '../hooks/useSellerOrder';
import { useSellerOrderActionFlow } from '../hooks/useSellerOrderActionFlow';
import { SELLER_ORDERS_PATH } from '../orders-href';
import { OrderDetailSkeleton } from './OrderDetailSkeleton';
import { SellerOrderActionDialogs } from './SellerOrderActionDialogs';
import { SellerOrderActions } from './SellerOrderActions';
import { SellerOrderDetailView } from './SellerOrderDetailView';
import { SellerRefundRequestCard } from './SellerRefundRequestCard';

interface SellerOrderDetailContainerProps {
  // shopId do page.tsx (composition root) truyền xuống sau khi resolve "shop của tôi".
  shopId: string;
  // null khi URL không phải id hợp lệ — page.tsx đã kiểm UUID trước khi truyền xuống nên không gọi
  // API với đường dẫn tuỳ ý.
  orderId: string | null;
}

// "Không tìm thấy" dùng chung cho id sai dạng và 404 từ BE: BE trả CÙNG 1 body 404 cho đơn không
// tồn tại, đơn của shop khác lẫn đơn chưa thanh toán (Seller không được biết nó có tồn tại), nên
// giao diện không thể (và không được) phân biệt các trường hợp đó.
function SellerOrderNotFound() {
  const t = useTranslations('order');

  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-sm text-destructive">
        {t('errorNotFound')}
      </p>
      <Button nativeButton={false} render={<Link href={SELLER_ORDERS_PATH} />}>
        {t('sellerDetailBackToList')}
      </Button>
    </div>
  );
}

function SellerOrderDetailLoader({ shopId, orderId }: { shopId: string; orderId: string }) {
  const t = useTranslations('order');
  const tCommon = useTranslations('common');

  const orderQuery = useSellerOrder(shopId, orderId);
  const flow = useSellerOrderActionFlow(shopId);

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
      return <SellerOrderNotFound />;
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

  const refundRequest = order.refundRequest;

  return (
    <div className="flex flex-col gap-4">
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}
      <SellerOrderDetailView
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
        refundRequestSection={
          refundRequest ? (
            <SellerRefundRequestCard
              request={refundRequest}
              isDisabled={flow.isActionPending}
              onApprove={() => flow.openApproveRefundDialog(refundRequest)}
              onReject={() => flow.openRejectRefundDialog(refundRequest)}
            />
          ) : null
        }
      />
      <SellerOrderActionDialogs {...flow.dialogs} />
    </div>
  );
}

// Nối dữ liệu (useSellerOrder + luồng hành động) với UI thuần SellerOrderDetailView. Đủ loading/
// error/404/thành công (rules/frontend.md mục 10). Container không cần unit test (mục 8) — logic có
// test ở useSellerOrderActionFlow, SellerOrderDetailView, SellerOrderActions, OrderTimeline.
export function SellerOrderDetailContainer({ shopId, orderId }: SellerOrderDetailContainerProps) {
  if (!orderId) {
    return <SellerOrderNotFound />;
  }

  return <SellerOrderDetailLoader shopId={shopId} orderId={orderId} />;
}
