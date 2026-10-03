'use client';

import { ImageOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { PAYMENT_METHOD_LABEL_KEYS } from '../order-status-display';
import type { OrderListItem } from '../types';
import {
  ORDER_CARD_CLASS,
  ORDER_CARD_FOOTER_CLASS,
  ORDER_CARD_HEADER_CLASS,
  ORDER_CARD_ITEM_ROW_CLASS,
  ORDER_CARD_SUMMARY_CLASS,
  ORDER_ITEM_THUMB_CLASS,
} from './order-card.constants';
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
  const format = useFormatter();

  const hiddenItemCount = Math.max(0, order.itemCount - order.items.length);
  const placedAt = format.dateTime(new Date(order.createdAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
    // Cố định theo múi giờ trình duyệt — giống SellerVouchersContainer; card chỉ render sau khi
    // tải xong ở client nên không lệch hydration.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

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
          <li key={item.sku} className={ORDER_CARD_ITEM_ROW_CLASS}>
            <div
              className={cn(
                ORDER_ITEM_THUMB_CLASS,
                'relative flex items-center justify-center overflow-hidden bg-muted',
              )}
            >
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  // Ảnh thuần trang trí — tên sản phẩm hiện ngay bên cạnh.
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              ) : (
                <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-sm font-medium text-foreground">
                {item.productName}
              </span>
              {item.variantLabel ? (
                <span className="text-xs text-muted-foreground">{item.variantLabel}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-sm text-foreground">{formatPrice(item.priceAtPurchase)}</span>
              <span className="text-xs text-muted-foreground">×{item.quantity}</span>
            </div>
          </li>
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
        <Link
          href={`/orders/${order.id}`}
          className="ml-auto inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('cardViewDetail')}
        </Link>
      </div>
    </article>
  );
}
