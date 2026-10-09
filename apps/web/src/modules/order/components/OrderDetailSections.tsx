'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';

import { formatPrice } from '@/modules/product';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { PAYMENT_METHOD_LABEL_KEYS, PAYMENT_STATUS_LABEL_KEYS } from '../order-status-display';
import type { OrderDetail, OrderListItem } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_DETAIL_SECTION_BODY_CLASS,
  ORDER_DETAIL_SECTION_TITLE_CLASS,
} from './order-card.constants';
import { OrderItemRow, type OrderItemRowProps } from './OrderItemRow';

// Các khối trình bày dùng chung giữa trang chi tiết của NGƯỜI MUA (OrderDetailView) và của SELLER
// (SellerOrderDetailView): hai bên nhận cùng các trường (dòng hàng, tiền, địa chỉ nhận, vận
// chuyển) với cùng kiểu, chỉ khác phần đầu trang và cách kể lịch sử. Mọi giá trị là SNAPSHOT lúc
// đặt do BE trả; tiền không tự cộng lại ở FE. Khai kiểu bằng Pick<OrderDetail, …> — bản của Seller
// khớp cấu trúc nên truyền thẳng được, không cần chuyển đổi.

export function DetailSection({
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

// Dòng hàng của người mua và của Seller dùng chung khối này. Phần dành riêng cho người mua (liên kết sản phẩm, nút
// đánh giá) đi qua `getItemProps` — nhận đúng loại dòng hàng của nơi gọi (generic) nên chi tiết đơn của người mua
// đọc được `productSlug`/`canReview`/`review` mà Seller không phải khai gì.
export function OrderItemsSection<TItem extends OrderListItem['items'][number]>({
  items,
  getItemProps,
}: {
  items: TItem[];
  getItemProps?: (item: TItem) => Pick<OrderItemRowProps, 'productSlug' | 'footer'>;
}) {
  const t = useTranslations('order');

  return (
    <DetailSection title={t('detailItemsTitle')} isPadded={false}>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <OrderItemRow key={item.sku} item={item} {...getItemProps?.(item)} />
        ))}
      </ul>
    </DetailSection>
  );
}

type PaymentFields = Pick<
  OrderDetail,
  'subtotal' | 'discountAmount' | 'shippingFee' | 'totalAmount' | 'paymentMethod' | 'paymentStatus'
>;

export function OrderPaymentSection({ order }: { order: PaymentFields }) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const hasDiscount = Number(order.discountAmount) > 0;

  return (
    <DetailSection title={t('detailSummaryTitle')}>
      <dl className="flex flex-col gap-1.5 text-sm">
        <SummaryRow label={t('detailSubtotalLabel')}>{formatPrice(order.subtotal)}</SummaryRow>
        {hasDiscount ? (
          <SummaryRow label={t('detailDiscountLabel')}>
            <span className="font-medium text-success">-{formatPrice(order.discountAmount)}</span>
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
  );
}

// Lời nhắn người mua gửi RIÊNG cho shop của đơn này (Week8.md 3B) — chỉ hiện khi có. Văn bản thuần:
// React tự escape nên `<img onerror>` hiện nguyên dạng chữ; `whitespace-pre-wrap` giữ các dòng người
// mua đã xuống, `break-words` để 1 chuỗi dài không dấu cách không làm tràn ngang ở 390px.
export function OrderBuyerNoteSection({
  note,
  viewer,
}: {
  note: OrderDetail['buyerNote'];
  // Cùng 1 lời nhắn, nhãn khác theo người xem: người mua "Lời nhắn cho shop", shop "Lời nhắn của người mua".
  viewer: 'buyer' | 'seller';
}) {
  const t = useTranslations('order');
  if (!note) return null;

  return (
    <DetailSection
      title={viewer === 'seller' ? t('detailBuyerNoteTitleSeller') : t('detailBuyerNoteTitleBuyer')}
    >
      <p className="text-sm break-words whitespace-pre-wrap text-foreground">{note}</p>
    </DetailSection>
  );
}

type AddressFields = Pick<
  OrderDetail,
  'recipientName' | 'recipientPhone' | 'shippingAddressLine' | 'shippingWard' | 'shippingProvince'
>;

export function OrderAddressSection({ order }: { order: AddressFields }) {
  const t = useTranslations('order');
  const address = [order.shippingAddressLine, order.shippingWard, order.shippingProvince]
    .filter(Boolean)
    .join(', ');

  return (
    <DetailSection title={t('detailAddressTitle')}>
      <address className="flex flex-col gap-0.5 text-sm not-italic">
        <span className="font-medium text-foreground">{order.recipientName}</span>
        <span className="text-muted-foreground">{order.recipientPhone}</span>
        <span className="text-foreground">{address}</span>
      </address>
    </DetailSection>
  );
}

// Chỉ hiện khi đơn đã có đơn vị vận chuyển hoặc mã vận đơn (cả hai đều tuỳ chọn khi giao hàng).
export function OrderShippingSection({
  order,
}: {
  order: Pick<OrderDetail, 'carrier' | 'trackingCode'>;
}) {
  const t = useTranslations('order');

  if (!order.carrier && !order.trackingCode) {
    return null;
  }

  return (
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
  );
}
