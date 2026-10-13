'use client';

import { useTranslations } from 'next-intl';

import { formatPrice } from '@/modules/product';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getRefundReasonLabelKey } from '@/shared/lib/refund-reason';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_ORDER_STATUS_LABEL_KEYS,
  ADMIN_PAYMENT_METHOD_LABEL_KEYS,
  ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS,
  ADMIN_REFUND_REQUEST_STATUS_DISPLAY,
  ADMIN_REFUND_STATUS_DISPLAY,
  getLatestSellerRejectionNote,
} from '../admin-refund-display';
import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminRefundRequest } from '../types';
import {
  ADMIN_REFUND_FIELD_LABEL_CLASS,
  ADMIN_REFUND_GRID_CLASS,
  ADMIN_REFUND_ROW_CLASS,
  ADMIN_REFUND_SHORT_CODE_LENGTH,
} from './admin-refund-row.constants';
import { AdminToneBadge } from './AdminToneBadge';

interface AdminRefundRequestRowProps {
  request: AdminRefundRequest;
  // Khoá mọi nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}

// Một dòng của hàng chờ khiếu nại — component THUẦN, dùng chung template cột với tiêu đề (MỘT markup duy nhất, từ
// `md` là bảng, dưới `md` là thẻ xếp dọc với nhãn từng trường, rules/frontend.md mục 5). Cột 1 là điều Admin cần
// đọc để quyết: loại yêu cầu, lý do + mô tả của người mua, LÝ DO SHOP TỪ CHỐI (từ `history`) và người mua; cột 2 là
// đơn (shop, người nhận, hàng, cách thanh toán, tiền, khoản hoàn nếu đã có); cột 3 là trạng thái + mốc thời gian
// phù hợp (chuyển lên sàn lúc nào / hạn shop phản hồi). Nút Chấp thuận/Từ chối CHỈ theo hai cờ `canApprove`/
// `canReject` do BE tính từ bảng chuyển có actor ADMIN — FE không tự suy. Chữ do người dùng nhập (lý do, ghi chú,
// tên, email) cắt dòng bằng CSS và `break-words`/`truncate` để chuỗi dài không dấu cách không đẩy trang rộng ra.
export function AdminRefundRequestRow({
  request,
  isDisabled,
  onApprove,
  onReject,
}: AdminRefundRequestRowProps) {
  const t = useTranslations('admin');
  const tOrder = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const tOrderDynamic = tOrder as unknown as LooseTranslator;
  const formatDateTime = useFormatAdminDateTime();
  const { order } = request;
  const firstItem = order.items[0];
  const shortCode = order.id.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH);
  const sellerNote = getLatestSellerRejectionNote(request.history);
  const target = `${request.shop.name} #${shortCode}`;

  return (
    <li className={cn(ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_ROW_CLASS)}>
      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnRequest')}</span>
        <p className="text-sm font-medium text-foreground">
          {tDynamic(ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS[request.kind])}
        </p>
        <p className="text-sm break-words text-foreground">
          {tOrderDynamic(getRefundReasonLabelKey(request.reasonCode))}
        </p>
        {request.reasonNote ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {t('refundsBuyerNote', { note: request.reasonNote })}
          </p>
        ) : null}
        {sellerNote ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {t('refundsSellerRejectionNote', { note: sellerNote })}
          </p>
        ) : null}
        <p className="truncate text-xs text-muted-foreground">
          {t('refundsBuyerLine', { name: request.buyer.name, email: request.buyer.email })}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnOrder')}</span>
        <p className="truncate text-sm font-medium text-foreground">{request.shop.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t('refundsOrderLine', { code: shortCode, name: order.recipientName })}
        </p>
        {firstItem ? (
          <p className="truncate text-xs text-muted-foreground">
            {firstItem.productName}
            {order.itemCount > 1 ? ` ${t('refundsMoreItems', { count: order.itemCount - 1 })}` : ''}
          </p>
        ) : null}
        <p className="truncate text-xs text-muted-foreground">
          {[
            order.paymentMethod
              ? tDynamic(ADMIN_PAYMENT_METHOD_LABEL_KEYS[order.paymentMethod])
              : null,
            tOrderDynamic(ADMIN_ORDER_STATUS_LABEL_KEYS[order.status]),
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('refundsTotalLabel')}: </span>
          <span className="font-semibold text-foreground">{formatPrice(order.totalAmount)}</span>
        </p>
        {order.refund ? (
          <p className="text-xs text-muted-foreground">
            {t('refundsOrderRefund', {
              status: tDynamic(ADMIN_REFUND_STATUS_DISPLAY[order.refund.status].labelKey),
              amount: formatPrice(order.refund.amount),
            })}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnStatus')}</span>
        <div>
          <AdminToneBadge display={ADMIN_REFUND_REQUEST_STATUS_DISPLAY[request.status]} />
        </div>
        <p className="text-xs text-muted-foreground">
          {request.status === 'PENDING_SELLER'
            ? t('refundsRespondBy', { date: formatDateTime(request.sellerRespondBy) })
            : request.status === 'ESCALATED'
              ? t('refundsEscalatedAt', { date: formatDateTime(request.statusChangedAt) })
              : t('refundsUpdatedAt', { date: formatDateTime(request.statusChangedAt) })}
        </p>
      </div>

      {/* `empty:hidden`: yêu cầu không còn hành động nào thì ô trống không chiếm chỗ. */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden md:flex-col md:items-stretch">
        {request.canApprove ? (
          <Button
            type="button"
            className="min-h-9"
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', {
              action: t('refundsActionApprove'),
              name: target,
            })}
            onClick={onApprove}
          >
            {t('refundsActionApprove')}
          </Button>
        ) : null}
        {request.canReject ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', {
              action: t('refundsActionReject'),
              name: target,
            })}
            onClick={onReject}
          >
            {t('refundsActionReject')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
