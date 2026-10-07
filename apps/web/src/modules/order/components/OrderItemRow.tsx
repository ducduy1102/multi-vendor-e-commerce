'use client';

import { ImageOff } from 'lucide-react';
import Image from 'next/image';

import { formatPrice } from '@/modules/product';
import { cn } from '@/shared/lib/utils';

import type { OrderListItem } from '../types';
import { ORDER_CARD_ITEM_ROW_CLASS, ORDER_ITEM_THUMB_CLASS } from './order-card.constants';

interface OrderItemRowProps {
  item: OrderListItem['items'][number];
}

// 1 dòng hàng (snapshot lúc đặt: tên, phân loại, đơn giá, số lượng) — dùng chung cho OrderCard
// (danh sách) và trang chi tiết. Render <li>: nơi dùng phải bọc trong <ul>.
export function OrderItemRow({ item }: OrderItemRowProps) {
  return (
    <li className={ORDER_CARD_ITEM_ROW_CLASS}>
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
        <span className="line-clamp-2 text-sm font-medium text-foreground">{item.productName}</span>
        {item.variantLabel ? (
          <span className="text-xs text-muted-foreground">{item.variantLabel}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm text-foreground">{formatPrice(item.priceAtPurchase)}</span>
        <span className="text-xs text-muted-foreground">×{item.quantity}</span>
      </div>
    </li>
  );
}
