'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { PAYMENT_METHOD_LABEL_KEYS, PAYMENT_STATUS_LABEL_KEYS } from '../order-status-display';
import { SELLER_ORDERS_PATH } from '../orders-href';
import { REFUND_REQUEST_TITLE_KEYS, getRefundReasonLabelKey } from '../refund-request-display';
import type { SellerRefundRequestListItem } from '../types';
import { RefundRequestStatusBadge } from './RefundRequestStatusBadge';
import { SellerRefundDeadline } from './SellerRefundDeadline';
import {
  SELLER_REFUND_FIELD_LABEL_CLASS,
  SELLER_REFUND_GRID_CLASS,
  SELLER_REFUND_ROW_CLASS,
} from './seller-refund-request-row.constants';

interface SellerRefundRequestRowProps {
  request: SellerRefundRequestListItem;
  // Khoá hai nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}

// Số ký tự đầu của mã đơn (UUID) hiện trên dòng để shop đối chiếu đơn; mã đầy đủ ở trang chi tiết (cùng độ dài
// với SellerOrderCard).
const SHORT_ORDER_CODE_LENGTH = 8;

// Một dòng của hàng chờ yêu cầu hủy/trả hàng — component THUẦN, dùng chung template cột với tiêu đề
// (SELLER_REFUND_GRID_CLASS): MỘT markup duy nhất, từ `md` là bảng, dưới `md` là thẻ xếp dọc với nhãn từng trường
// (rules/frontend.md mục 5). Cột 1 là điều người mua nói (loại, lý do, mô tả), cột 2 đủ thông tin đơn để quyết
// định mà không phải mở đơn (người nhận, hàng, cách thanh toán, tiền), cột 3 là trạng thái + hạn phản hồi (rõ nhất
// khi còn chờ shop), cột 4 là thao tác. Nút Chấp thuận/Từ chối CHỈ theo hai cờ `canApprove`/`canReject` do BE tính
// — yêu cầu đã xử lý không có nút nào, chỉ còn "Xem đơn". Chữ do người mua nhập (lý do, mô tả) cắt dòng bằng CSS
// và `break-words` để chuỗi dài không dấu cách không đẩy trang rộng ra.
export function SellerRefundRequestRow({
  request,
  isDisabled,
  onApprove,
  onReject,
}: SellerRefundRequestRowProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();
  const { order } = request;
  const firstItem = order.items[0];
  const paymentParts = [
    order.paymentMethod ? tDynamic(PAYMENT_METHOD_LABEL_KEYS[order.paymentMethod]) : null,
    order.paymentStatus ? tDynamic(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus]) : null,
  ].filter((part): part is string => part !== null);

  return (
    <li className={cn(SELLER_REFUND_GRID_CLASS, SELLER_REFUND_ROW_CLASS)}>
      <div className="grid grid-cols-1 gap-1">
        <span className={SELLER_REFUND_FIELD_LABEL_CLASS}>{t('refundQueueColumnRequest')}</span>
        <p className="text-sm font-medium text-foreground">
          {tDynamic(REFUND_REQUEST_TITLE_KEYS[request.kind])}
        </p>
        <p className="text-sm break-words text-foreground">
          {tDynamic(getRefundReasonLabelKey(request.reasonCode))}
        </p>
        {request.reasonNote ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {request.reasonNote}
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={SELLER_REFUND_FIELD_LABEL_CLASS}>{t('refundQueueColumnOrder')}</span>
        <p className="truncate text-sm font-medium text-foreground">{order.recipientName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t('sellerCardCode', { code: order.id.slice(0, SHORT_ORDER_CODE_LENGTH) })}
        </p>
        {firstItem ? (
          <p className="truncate text-xs text-muted-foreground">
            {firstItem.productName}
            {order.itemCount > 1 ? ` ${t('cardMoreItems', { count: order.itemCount - 1 })}` : ''}
          </p>
        ) : null}
        {paymentParts.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">{paymentParts.join(' · ')}</p>
        ) : null}
        <p className="text-sm">
          <span className="text-muted-foreground">{t('cardTotalLabel')}: </span>
          <span className="font-semibold text-foreground">{formatPrice(order.totalAmount)}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <span className={SELLER_REFUND_FIELD_LABEL_CLASS}>{t('refundQueueColumnStatus')}</span>
        <div>
          <RefundRequestStatusBadge status={request.status} />
        </div>
        {request.status === 'PENDING_SELLER' ? (
          <SellerRefundDeadline kind={request.kind} respondBy={request.sellerRespondBy} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('refundQueueUpdatedAt', { date: formatDate(request.statusChangedAt) })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <span className={SELLER_REFUND_FIELD_LABEL_CLASS}>{t('refundQueueColumnActions')}</span>
        <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
          {request.canApprove ? (
            <Button type="button" className="min-h-9" disabled={isDisabled} onClick={onApprove}>
              {t('actionApproveRequest')}
            </Button>
          ) : null}
          {request.canReject ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-9"
              disabled={isDisabled}
              onClick={onReject}
            >
              {t('actionRejectRequest')}
            </Button>
          ) : null}
          <Link
            href={`${SELLER_ORDERS_PATH}/${order.id}`}
            className="inline-flex min-h-9 items-center justify-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('refundQueueViewOrder')}
          </Link>
        </div>
      </div>
    </li>
  );
}
