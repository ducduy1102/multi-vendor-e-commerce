'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { formatPrice } from '@/modules/product';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { PAYMENT_METHOD_LABEL_KEYS, PAYMENT_STATUS_LABEL_KEYS } from '../order-status-display';
import type { SellerOrderListItem } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_CARD_SUMMARY_CLASS,
} from './order-card.constants';
import { OrderItemRow } from './OrderItemRow';
import { OrderStatusBadge } from './OrderStatusBadge';

interface SellerOrderCardProps {
  order: SellerOrderListItem;
  // Nút hành động (SellerOrderActions) do Container truyền vào — card không biết mutation nào.
  actions?: ReactNode;
}

// Số ký tự đầu của mã đơn (UUID) hiện trên card để Seller gọi tên/đối chiếu đơn; mã đầy đủ ở trang
// chi tiết. 8 ký tự hex đủ phân biệt các đơn của 1 shop.
const SHORT_ORDER_CODE_LENGTH = 8;

// Card gọn của 1 đơn trong danh sách của shop (marketplace: mật độ thông tin cao): người nhận +
// tỉnh/thành + trạng thái, tối đa 3 dòng hàng xem nhanh (BE giới hạn, `itemCount` là tổng), thời
// điểm đặt + cách thanh toán (Seller cần biết đơn COD còn phải thu tiền khi giao), tổng tiền.
// Component THUẦN trình bày; chỉ lộ thông tin NGƯỜI NHẬN trên đơn (không có email/userId của buyer).
export function SellerOrderCard({ order, actions }: SellerOrderCardProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();

  const hiddenItemCount = Math.max(0, order.itemCount - order.items.length);
  const paymentParts = [
    order.paymentMethod ? tDynamic(PAYMENT_METHOD_LABEL_KEYS[order.paymentMethod]) : null,
    order.paymentStatus ? tDynamic(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus]) : null,
  ].filter((part): part is string => part !== null);

  return (
    <article className={ORDER_CARD_CLASS}>
      <header className={ORDER_CARD_HEADER_CLASS}>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold text-foreground">{order.recipientName}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {t('sellerCardCode', { code: order.id.slice(0, SHORT_ORDER_CODE_LENGTH) })}
            {' · '}
            {order.shippingProvince}
          </p>
        </div>
        <OrderStatusBadge status={order.status} className="shrink-0" />
      </header>

      <ul className="divide-y divide-border">
        {order.items.map((item) => (
          <OrderItemRow key={item.sku} item={item} />
        ))}
      </ul>

      {hiddenItemCount > 0 ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground sm:px-4">
          {t('cardMoreItems', { count: hiddenItemCount })}
        </p>
      ) : null}

      <div className={ORDER_CARD_SUMMARY_CLASS}>
        <p className="text-xs text-muted-foreground">
          {t('cardPlacedAt', { date: formatDate(order.createdAt) })}
          {paymentParts.length > 0 ? ` · ${paymentParts.join(' · ')}` : ''}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('cardTotalLabel')}: </span>
          <span className="font-semibold text-foreground">{formatPrice(order.totalAmount)}</span>
        </p>
      </div>

      {actions ? <div className={ORDER_CARD_FOOTER_CLASS}>{actions}</div> : null}
    </article>
  );
}
