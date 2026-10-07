'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import type { SellerOrderDetail } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_GRID_CLASS,
} from './order-card.constants';
import {
  DetailSection,
  OrderAddressSection,
  OrderBuyerNoteSection,
  OrderItemsSection,
  OrderPaymentSection,
  OrderShippingSection,
} from './OrderDetailSections';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderTimeline } from './OrderTimeline';

interface SellerOrderDetailViewProps {
  order: SellerOrderDetail;
  // Nút hành động (SellerOrderActions) do Container truyền vào — view không biết mutation nào.
  actions?: ReactNode;
}

// Chi tiết 1 đơn của shop — component THUẦN từ `SellerOrderDetail`. Seller cần đủ thông tin để đóng
// gói và giao: mọi dòng hàng, người nhận (tên, SĐT, địa chỉ đầy đủ — snapshot trên đơn), cách thanh
// toán (đơn COD còn phải thu tiền khi giao), lời nhắn của người mua cho shop này (nếu có), vận chuyển
// và lịch sử. KHÔNG có định danh tài khoản người mua (BE không trả userId/email).
// Cùng bố cục với trang chi tiết của người mua, chung các khối ở OrderDetailSections.
export function SellerOrderDetailView({ order, actions }: SellerOrderDetailViewProps) {
  const t = useTranslations('order');
  const formatDate = useFormatOrderDate();

  return (
    <div className="flex flex-col gap-4">
      <section className={ORDER_CARD_CLASS}>
        <div className={ORDER_CARD_HEADER_CLASS}>
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {order.recipientName}
          </h2>
          <OrderStatusBadge status={order.status} className="shrink-0" />
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          <p className="break-all">{t('detailOrderCode', { id: order.id })}</p>
          <p>{t('cardPlacedAt', { date: formatDate(order.createdAt) })}</p>
        </div>
        {/* empty:hidden — SellerOrderActions trả null khi không có hành động nào, khi đó ẩn cả dải viền. */}
        <div className={cn(ORDER_CARD_FOOTER_CLASS, 'empty:hidden')}>{actions}</div>
      </section>

      <div className={ORDER_DETAIL_GRID_CLASS}>
        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <OrderItemsSection items={order.items} />

          <DetailSection title={t('timelineTitle')}>
            <OrderTimeline history={order.history} viewer="seller" />
          </DetailSection>
        </div>

        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <OrderAddressSection order={order} />
          <OrderBuyerNoteSection note={order.buyerNote} viewer="seller" />
          <OrderPaymentSection order={order} />
          <OrderShippingSection order={order} />
        </div>
      </div>
    </div>
  );
}
