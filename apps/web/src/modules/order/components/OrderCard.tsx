'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { PAYMENT_METHOD_LABEL_KEYS } from '../order-status-display';
import type { OrderListItem } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_CARD_DETAIL_LINK_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_CARD_SUMMARY_CLASS,
} from './order-card.constants';
import { OrderItemRow } from './OrderItemRow';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderCardProps {
  order: OrderListItem;
  // Nút hành động (OrderActions) do Container truyền vào — card không biết mutation/hộp thoại nào.
  actions?: ReactNode;
}

// Card gọn của 1 đơn trong danh sách (marketplace: mật độ thông tin cao): tên shop + trạng thái,
// tối đa 3 dòng hàng xem nhanh (BE giới hạn, `itemCount` là tổng), ngày đặt + phương thức, tổng
// tiền. Component THUẦN trình bày; mọi số tiền là snapshot lúc đặt do BE trả, không tự cộng lại.
export function OrderCard({ order, actions }: OrderCardProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();

  const hiddenItemCount = Math.max(0, order.itemCount - order.items.length);
  const placedAt = formatDate(order.createdAt);

  return (
    <article className={ORDER_CARD_CLASS}>
      <header className={ORDER_CARD_HEADER_CLASS}>
        <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {order.shop.name}
        </h2>
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
          {t('cardPlacedAt', { date: placedAt })}
          {order.paymentMethod
            ? ` · ${tDynamic(PAYMENT_METHOD_LABEL_KEYS[order.paymentMethod])}`
            : ''}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('cardTotalLabel')}: </span>
          <span className="font-semibold text-foreground">{formatPrice(order.totalAmount)}</span>
        </p>
      </div>

      <div className={ORDER_CARD_FOOTER_CLASS}>
        {actions}
        <Link href={`/orders/${order.id}`} className={ORDER_CARD_DETAIL_LINK_CLASS}>
          {t('cardViewDetail')}
        </Link>
      </div>
    </article>
  );
}
