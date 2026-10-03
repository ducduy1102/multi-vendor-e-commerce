'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';

import { formatPrice } from '@/modules/product';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { PAYMENT_METHOD_LABEL_KEYS, PAYMENT_STATUS_LABEL_KEYS } from '../order-status-display';
import type { OrderDetail } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_GRID_CLASS,
  ORDER_DETAIL_SECTION_BODY_CLASS,
  ORDER_DETAIL_SECTION_TITLE_CLASS,
} from './order-card.constants';
import { OrderItemRow } from './OrderItemRow';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderTimeline } from './OrderTimeline';

interface OrderDetailViewProps {
  order: OrderDetail;
  // Nút hành động (OrderActions) do Container truyền vào — view không biết mutation/hộp thoại nào.
  actions?: ReactNode;
}

function DetailSection({
  title,
  children,
  isPadded = true,
}: {
  title: string;
  children: ReactNode;
  // false: nội dung tự có đệm riêng (danh sách dòng hàng đã có padding từng dòng).
  isPadded?: boolean;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={ORDER_CARD_CLASS}>
      <h2 id={headingId} className={ORDER_DETAIL_SECTION_TITLE_CLASS}>
        {title}
      </h2>
      {isPadded ? <div className={ORDER_DETAIL_SECTION_BODY_CLASS}>{children}</div> : children}
    </section>
  );
}

function SummaryRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  );
}

// Chi tiết 1 đơn của người mua — component THUẦN từ `OrderDetail`: mọi số tiền/địa chỉ/dòng hàng là
// SNAPSHOT lúc đặt do BE trả (không đổi khi shop sửa sản phẩm sau đó), tiền không tự cộng lại ở FE.
// Mobile 1 cột (trạng thái → dòng hàng → lịch sử → thanh toán → địa chỉ), từ lg thêm cột phụ.
export function OrderDetailView({ order, actions }: OrderDetailViewProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();

  const hasDiscount = Number(order.discountAmount) > 0;
  const hasShippingInfo = Boolean(order.carrier) || Boolean(order.trackingCode);
  const address = [order.shippingAddressLine, order.shippingWard, order.shippingProvince]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-4">
      <section className={ORDER_CARD_CLASS}>
        <div className={ORDER_CARD_HEADER_CLASS}>
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {order.shop.name}
          </h2>
          <OrderStatusBadge status={order.status} className="shrink-0" />
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          <p className="break-all">{t('detailOrderCode', { id: order.id })}</p>
          <p>{t('cardPlacedAt', { date: formatDate(order.createdAt) })}</p>
        </div>
        {/* empty:hidden — OrderActions trả null khi không có hành động nào, khi đó ẩn cả dải viền. */}
        <div className={cn(ORDER_CARD_FOOTER_CLASS, 'empty:hidden')}>{actions}</div>
      </section>

      <div className={ORDER_DETAIL_GRID_CLASS}>
        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <DetailSection title={t('detailItemsTitle')} isPadded={false}>
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <OrderItemRow key={item.sku} item={item} />
              ))}
            </ul>
          </DetailSection>

          <DetailSection title={t('timelineTitle')}>
            <OrderTimeline history={order.history} />
          </DetailSection>
        </div>

        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <DetailSection title={t('detailSummaryTitle')}>
            <dl className="flex flex-col gap-1.5 text-sm">
              <SummaryRow label={t('detailSubtotalLabel')}>
                {formatPrice(order.subtotal)}
              </SummaryRow>
              {hasDiscount ? (
                <SummaryRow label={t('detailDiscountLabel')}>
                  <span className="font-medium text-success">
                    -{formatPrice(order.discountAmount)}
                  </span>
                </SummaryRow>
              ) : null}
              <SummaryRow label={t('detailShippingFeeLabel')}>
                {formatPrice(order.shippingFee)}
              </SummaryRow>
              <SummaryRow
                label={t('detailTotalLabel')}
                className="border-t border-border pt-1.5 font-semibold"
              >
                {formatPrice(order.totalAmount)}
              </SummaryRow>
            </dl>

            {order.paymentMethod || order.paymentStatus ? (
              <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
                {order.paymentMethod ? (
                  <SummaryRow label={t('detailPaymentMethodLabel')}>
                    {tDynamic(PAYMENT_METHOD_LABEL_KEYS[order.paymentMethod])}
                  </SummaryRow>
                ) : null}
                {order.paymentStatus ? (
                  <SummaryRow label={t('detailPaymentStatusLabel')}>
                    {tDynamic(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus])}
                  </SummaryRow>
                ) : null}
              </dl>
            ) : null}
          </DetailSection>

          <DetailSection title={t('detailAddressTitle')}>
            <address className="flex flex-col gap-0.5 text-sm not-italic">
              <span className="font-medium text-foreground">{order.recipientName}</span>
              <span className="text-muted-foreground">{order.recipientPhone}</span>
              <span className="text-foreground">{address}</span>
            </address>
          </DetailSection>

          {hasShippingInfo ? (
            <DetailSection title={t('detailShippingTitle')}>
              <dl className="flex flex-col gap-1.5 text-sm">
                {order.carrier ? (
                  <SummaryRow label={t('detailCarrierLabel')}>{order.carrier}</SummaryRow>
                ) : null}
                {order.trackingCode ? (
                  <SummaryRow label={t('detailTrackingCodeLabel')}>
                    <span className="break-all">{order.trackingCode}</span>
                  </SummaryRow>
                ) : null}
              </dl>
            </DetailSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}
