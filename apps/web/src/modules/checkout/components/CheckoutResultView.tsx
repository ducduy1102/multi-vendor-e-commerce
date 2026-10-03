'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import type { CheckoutGroup, CheckoutGroupStatus, PaymentMethod } from '../types';

interface CheckoutResultViewProps {
  group: CheckoutGroup;
  // "Tải lại" — hỏi lại BE trạng thái mới nhất, dùng khi polling đã dừng (1.10) mà IPN có thể vừa tới.
  onReload: () => void;
  isReloading: boolean;
  // "Tiếp tục thanh toán"/"Thanh toán lại" — cùng 1 hành động (POST /checkout/groups/:id/pay), chỉ
  // khác chữ trên nút theo trạng thái (1.11); hiện khi group.canRetry (BE đã suy sẵn, không tự đoán lại ở FE).
  onRetryPayment: () => void;
  isRetryingPayment: boolean;
  retryPaymentError: string | null;
}

const STATUS_ALERT_VARIANT: Record<
  CheckoutGroupStatus,
  'default' | 'success' | 'destructive' | 'warning'
> = {
  PAID: 'success',
  AWAITING_PAYMENT: 'default',
  PAYMENT_FAILED: 'destructive',
  PAYMENT_EXPIRED: 'destructive',
  CANCELLED: 'destructive',
  PAID_AFTER_EXPIRY: 'warning',
  COD_PLACED: 'default',
};

const STATUS_MESSAGE_KEY: Record<CheckoutGroupStatus, string> = {
  PAID: 'resultStatusPaid',
  AWAITING_PAYMENT: 'resultStatusAwaitingPayment',
  PAYMENT_FAILED: 'resultStatusPaymentFailed',
  PAYMENT_EXPIRED: 'resultStatusPaymentExpired',
  CANCELLED: 'resultStatusCancelled',
  PAID_AFTER_EXPIRY: 'resultStatusPaidAfterExpiry',
  COD_PLACED: 'resultStatusCodPlaced',
};

const PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  VNPAY: 'paymentMethodVnpayLabel',
  MOMO: 'paymentMethodMomoLabel',
  COD: 'paymentMethodCodLabel',
};

// Trang kết quả (Week7.md 3.6) hiển thị ĐÚNG theo `status` BE đã suy ra từ Order/Payment thật
// (1.13) — component THUẦN chỉ nhận `group` qua props, không tự đọc/tin bất kỳ tham số nào của cổng
// thanh toán trên URL (1.10: `vnp_ResponseCode=00` trên URL không có nghĩa lý gì ở đây, chỉ
// `group.status` mới quyết định hiển thị). Mọi state/side-effect (polling, mutation) do
// CheckoutResultContainer quản lý.
export function CheckoutResultView({
  group,
  onReload,
  isReloading,
  onRetryPayment,
  isRetryingPayment,
  retryPaymentError,
}: CheckoutResultViewProps) {
  const t = useTranslations('checkout');
  const tHome = useTranslations('home');
  // Key tra theo enum (STATUS_MESSAGE_KEY/PAYMENT_METHOD_LABEL_KEY) không phải literal nên next-intl
  // không tự suy được kiểu key hẹp — ép về LooseTranslator (cùng cách CartSummary/error-codes.ts đã
  // làm cho key động), vẫn CÙNG 1 namespace 'checkout' nên không cần useTranslations() toàn cục.
  const tDynamic = t as unknown as LooseTranslator;
  const isAwaitingPayment = group.status === 'AWAITING_PAYMENT';

  return (
    <div className="flex flex-col gap-6">
      <Alert variant={STATUS_ALERT_VARIANT[group.status]}>
        {tDynamic(STATUS_MESSAGE_KEY[group.status])}
      </Alert>

      <dl className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('summaryGrandTotalLabel')}</dt>
          <dd className="font-semibold text-foreground">{formatPrice(group.totalAmount)}</dd>
        </div>
        {group.paymentMethod ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('paymentMethodSectionTitle')}</dt>
            <dd className="text-foreground">
              {tDynamic(PAYMENT_METHOD_LABEL_KEY[group.paymentMethod])}
            </dd>
          </div>
        ) : null}
      </dl>

      {group.orders.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
          <h2 className="text-sm font-semibold text-foreground">{t('resultOrdersTitle')}</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {group.orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-2">
                <span className="text-foreground">{order.shopName}</span>
                <span className="text-muted-foreground">{formatPrice(order.totalAmount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {retryPaymentError ? <Alert variant="destructive">{retryPaymentError}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {isAwaitingPayment ? (
          <Button type="button" variant="outline" onClick={onReload} disabled={isReloading}>
            {t('retry')}
          </Button>
        ) : null}
        {group.canRetry ? (
          <Button type="button" onClick={onRetryPayment} disabled={isRetryingPayment}>
            {isRetryingPayment
              ? t('placeOrderSubmitting')
              : isAwaitingPayment
                ? t('resultContinuePaymentButton')
                : t('resultRetryPaymentButton')}
          </Button>
        ) : null}
        {/* Đơn đã nằm trong Đơn hàng của tôi dù kết quả thế nào (thành công, COD, hết hạn, đã huỷ…) —
            nút này là lối ra chính khi KHÔNG còn việc thanh toán lại phải làm; còn thanh toán lại
            thì nút thanh toán là chính, 2 nút kia lùi xuống. */}
        <Button
          variant={group.canRetry ? 'outline' : 'default'}
          nativeButton={false}
          render={<Link href="/orders" />}
        >
          {t('resultViewOrdersButton')}
        </Button>
        <Button
          variant={group.canRetry ? 'ghost' : 'outline'}
          nativeButton={false}
          render={<Link href="/products" />}
        >
          {tHome('bannerCta')}
        </Button>
      </div>
    </div>
  );
}
