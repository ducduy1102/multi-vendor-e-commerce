'use client';

import { useTranslations } from 'next-intl';

import { formatPrice } from '@/modules/product';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY,
  ADMIN_ORDER_STATUS_LABEL_KEYS,
  ADMIN_PAYMENT_METHOD_LABEL_KEYS,
} from '../admin-refund-display';
import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminRefundablePayment } from '../types';
import {
  ADMIN_REFUND_FIELD_LABEL_CLASS,
  ADMIN_REFUND_GRID_CLASS,
  ADMIN_REFUND_ROW_CLASS,
  ADMIN_REFUND_SHORT_CODE_LENGTH,
} from './admin-refund-row.constants';
import { AdminToneBadge } from './AdminToneBadge';

interface AdminRefundablePaymentRowProps {
  payment: AdminRefundablePayment;
  // Khoá nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onRefund: () => void;
}

// Một dòng của "thanh toán cần hoàn" — component THUẦN, cùng lưới với tiêu đề. Cột 1 là khoản tiền (số tiền, cách
// thanh toán, lúc trả, người mua, các mã để tìm giao dịch bên cổng); cột 2 là CÁC ĐƠN của lần đặt hàng đó (Admin
// thấy vì sao khoản này bất thường: mọi đơn đã hủy / khách trả hai lần); cột 3 là loại bất thường kèm câu giải thích.
// Mọi thanh toán ở đây BE đã lọc là chưa có khoản hoàn nào nên chỉ có một hành động: "Hoàn tiền" (qua hộp thoại xác
// nhận ở nơi dùng). Mã giao dịch do cổng trả có thể dài và không có dấu cách nên dùng `break-all`.
export function AdminRefundablePaymentRow({
  payment,
  isDisabled,
  onRefund,
}: AdminRefundablePaymentRowProps) {
  const t = useTranslations('admin');
  const tOrder = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const tOrderDynamic = tOrder as unknown as LooseTranslator;
  const formatDateTime = useFormatAdminDateTime();
  const kind = ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY[payment.kind];
  const target = `#${payment.txnRef.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH)}`;

  return (
    <li className={cn(ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_ROW_CLASS)}>
      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnPayment')}</span>
        <p className="text-sm font-semibold text-foreground">{formatPrice(payment.amount)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {tDynamic(ADMIN_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
          {payment.paidAt
            ? ` · ${t('refundsPaidAt', { date: formatDateTime(payment.paidAt) })}`
            : ''}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('refundsBuyerLine', { name: payment.buyer.name, email: payment.buyer.email })}
        </p>
        <p className="text-xs break-all text-muted-foreground">
          {t('refundsTxnRef', { value: payment.txnRef })}
        </p>
        {payment.transactionId ? (
          <p className="text-xs break-all text-muted-foreground">
            {t('refundsGatewayTransaction', { value: payment.transactionId })}
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-1">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnOrders')}</span>
        <ul className="grid grid-cols-1 gap-1">
          {payment.orders.map((order) => (
            <li key={order.id} className="truncate text-xs text-muted-foreground">
              {t('refundsPaymentOrderLine', {
                code: order.id.slice(0, ADMIN_REFUND_SHORT_CODE_LENGTH),
                status: tOrderDynamic(ADMIN_ORDER_STATUS_LABEL_KEYS[order.status]),
                amount: formatPrice(order.totalAmount),
              })}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <span className={ADMIN_REFUND_FIELD_LABEL_CLASS}>{t('refundsColumnAbnormal')}</span>
        <div>
          <AdminToneBadge display={kind} />
        </div>
        <p className="text-xs text-muted-foreground">{tDynamic(kind.hintKey)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
        <Button
          type="button"
          className="min-h-9"
          disabled={isDisabled}
          aria-label={t('actionLabelWithShop', {
            action: t('refundsActionRefundPayment'),
            name: target,
          })}
          onClick={onRefund}
        >
          {t('refundsActionRefundPayment')}
        </Button>
      </div>
    </li>
  );
}
