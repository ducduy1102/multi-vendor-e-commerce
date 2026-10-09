'use client';

import { useTranslations } from 'next-intl';

import { formatPrice } from '@/modules/product';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_PAYMENT_METHOD_LABEL_KEYS,
  ADMIN_REFUND_STATUS_DISPLAY,
} from '../admin-refund-display';
import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminRefund } from '../types';
import {
  ADMIN_REFUND_FIELD_LABEL_CLASS,
  ADMIN_REFUND_GRID_CLASS,
  ADMIN_REFUND_ROW_CLASS,
  ADMIN_REFUND_SHORT_CODE_LENGTH,
} from './admin-refund-row.constants';
import { AdminToneBadge } from './AdminToneBadge';

interface AdminRefundRowProps {
  refund: AdminRefund;
  // Khoá mọi nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onRetry: () => void;
  onMarkCompleted: () => void;
}

// Một dòng của sổ cái hoàn tiền — component THUẦN, cùng lưới với tiêu đề. Cột 1 là khoản tiền (số tiền, cách thanh
// toán, người mua, lý do hoàn, số lần đã gọi cổng); cột 2 là CÁC MÃ để tìm giao dịch trên trang merchant của cổng
// khi hoàn tay (mã tham chiếu giao dịch `txnRef`, mã giao dịch của cổng, mã hoàn nếu có) kèm đơn gắn với khoản này
// (hoặc nói rõ là thanh toán bất thường không gắn đơn); cột 3 là trạng thái + LÝ DO LỖI nội bộ của cổng (chỉ Admin
// thấy — BE không trả cho buyer/seller). Nút "Thử lại"/"Ghi nhận đã hoàn tay" CHỈ theo `canRetry`/`canMarkCompleted`
// do BE tính từ đúng điều kiện mà route kiểm lại khi thực thi (FAILED, hoặc PENDING quá 5 phút). Mã và lý do lỗi do
// cổng trả có thể dài và không có dấu cách nên dùng `break-all`/`break-words` thay vì để đẩy trang rộng ra.
export function AdminRefundRow({
  refund,
  isDisabled,
  onRetry,
  onMarkCompleted,
}: AdminRefundRowProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDateTime = useFormatAdminDateTime();
  const { payment, order } = refund;
  const target = order
    ? `#${order.id.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH)}`
    : `#${payment.txnRef.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH)}`;

  return (
    <li className={cn(ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_ROW_CLASS)}>
      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnRefund')}</span>
        <p className="text-sm font-semibold text-foreground">{formatPrice(refund.amount)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {tDynamic(ADMIN_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
          {' · '}
          {t('refundsCreatedAt', { date: formatDateTime(refund.createdAt) })}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('refundsBuyerLine', { name: refund.buyer.name, email: refund.buyer.email })}
        </p>
        {refund.reason ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {t('refundsReasonLine', { reason: refund.reason })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t('refundsAttempts', { count: refund.attempts })}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnPayment')}</span>
        <p className="truncate text-sm text-foreground">
          {order
            ? t('refundsOrderLine', {
                code: order.id.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH),
                name: order.recipientName,
              })
            : t('refundsNoOrder')}
        </p>
        <p className="text-xs break-all text-muted-foreground">
          {t('refundsTxnRef', { value: payment.txnRef })}
        </p>
        {payment.transactionId ? (
          <p className="text-xs break-all text-muted-foreground">
            {t('refundsGatewayTransaction', { value: payment.transactionId })}
          </p>
        ) : null}
        {refund.gatewayRef ? (
          <p className="text-xs break-all text-muted-foreground">
            {t('refundsGatewayRef', { value: refund.gatewayRef })}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnStatus')}</span>
        <div>
          <AdminToneBadge display={ADMIN_REFUND_STATUS_DISPLAY[refund.status]} />
        </div>
        {refund.failureReason ? (
          <p className="line-clamp-3 text-xs break-words text-muted-foreground">
            {t('refundsFailureReason', { reason: refund.failureReason })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {refund.completedAt
            ? t('refundsCompletedAt', { date: formatDateTime(refund.completedAt) })
            : t('refundsUpdatedAt', { date: formatDateTime(refund.updatedAt) })}
        </p>
      </div>

      {/* `empty:hidden`: khoản không còn hành động nào (đã hoàn, hoặc PENDING còn mới) thì ô trống không chiếm chỗ. */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden md:flex-col md:items-stretch">
        {refund.canRetry ? (
          <Button
            type="button"
            className="min-h-9"
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', { action: t('refundsActionRetry'), name: target })}
            onClick={onRetry}
          >
            {t('refundsActionRetry')}
          </Button>
        ) : null}
        {refund.canMarkCompleted ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={isDisabled}
            aria-label={t('actionLabelWithShop', {
              action: t('refundsActionMarkCompleted'),
              name: target,
            })}
            onClick={onMarkCompleted}
          >
            {t('refundsActionMarkCompleted')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
