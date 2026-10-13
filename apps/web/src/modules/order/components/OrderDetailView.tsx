'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import type { OrderDetail, OrderDetailItem } from '../types';
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

interface OrderDetailViewProps {
  order: OrderDetail;
  // Nút hành động (OrderActions) do Container truyền vào — view không biết mutation/hộp thoại nào.
  actions?: ReactNode;
  // Dải bên dưới từng dòng hàng (nút "Viết đánh giá"/"Sửa" do Container nối) — view không biết hộp thoại nào.
  // Không truyền thì dòng hàng không có dải.
  renderItemFooter?: (item: OrderDetailItem) => ReactNode;
  // Thẻ yêu cầu hủy/trả hàng (RefundRequestCard) do Container dựng khi đơn có yêu cầu — đặt NGAY TRÊN danh
  // sách dòng hàng vì là thứ người mua cần xem đầu tiên khi có yêu cầu đang chạy.
  refundRequestSection?: ReactNode;
}

// Chi tiết 1 đơn của người mua — component THUẦN từ `OrderDetail`: mọi số tiền/địa chỉ/dòng hàng là
// SNAPSHOT lúc đặt do BE trả (không đổi khi shop sửa sản phẩm sau đó), tiền không tự cộng lại ở FE.
// Mobile 1 cột (trạng thái → dòng hàng → lịch sử → thanh toán → địa chỉ), từ lg thêm cột phụ.
// Các khối dòng hàng/thanh toán/địa chỉ/vận chuyển dùng chung với trang chi tiết của Seller
// (OrderDetailSections).
export function OrderDetailView({
  order,
  actions,
  renderItemFooter,
  refundRequestSection,
}: OrderDetailViewProps) {
  const t = useTranslations('order');
  const formatDate = useFormatOrderDate();

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
          {refundRequestSection}

          {/* Tên hàng là liên kết tới trang sản phẩm bằng `productSlug` BE trả sẵn trong từng dòng. */}
          <OrderItemsSection
            items={order.items}
            getItemProps={(item) => ({
              productSlug: item.productSlug,
              footer: renderItemFooter?.(item),
            })}
          />

          <DetailSection title={t('timelineTitle')}>
            <OrderTimeline history={order.history} />
          </DetailSection>
        </div>

        <div className={ORDER_DETAIL_COLUMN_CLASS}>
          <OrderPaymentSection order={order} refund={order.refund} />
          <OrderAddressSection order={order} />
          <OrderBuyerNoteSection note={order.buyerNote} viewer="buyer" />
          <OrderShippingSection order={order} />
        </div>
      </div>
    </div>
  );
}
