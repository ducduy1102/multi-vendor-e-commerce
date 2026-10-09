'use client';

import { ImageOff } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { cn } from '@/shared/lib/utils';

import type { OrderListItem } from '../types';
import { ORDER_CARD_ITEM_ROW_CLASS, ORDER_ITEM_THUMB_CLASS } from './order-card.constants';

export interface OrderItemRowProps {
  item: OrderListItem['items'][number];
  // Chỉ chi tiết đơn của NGƯỜI MUA có (BE trả `productSlug` ở orderDetailItemSchema): có thì tên hàng là liên
  // kết tới trang sản phẩm — link dựng từ slug BE đã trả sẵn, module order không import dữ liệu sản phẩm.
  productSlug?: string;
  // Dải bên dưới dòng (vd nút "Viết đánh giá" của chi tiết đơn). Nơi gọi truyền `null`/không truyền thì dải ẩn
  // hẳn (`empty:hidden`), dòng giữ nguyên bố cục cũ.
  footer?: ReactNode;
}

// 1 dòng hàng (snapshot lúc đặt: tên, phân loại, đơn giá, số lượng) — dùng chung cho OrderCard
// (danh sách) và trang chi tiết. Render <li>: nơi dùng phải bọc trong <ul>. Component thuần: liên kết và dải
// hành động đều do nơi gọi truyền vào qua props.
export function OrderItemRow({ item, productSlug, footer }: OrderItemRowProps) {
  return (
    <li className={cn(ORDER_CARD_ITEM_ROW_CLASS, footer ? 'flex-wrap' : null)}>
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
        {productSlug ? (
          <Link
            href={`/products/${productSlug}`}
            className="line-clamp-2 rounded-sm text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {item.productName}
          </Link>
        ) : (
          <span className="line-clamp-2 text-sm font-medium text-foreground">
            {item.productName}
          </span>
        )}
        {item.variantLabel ? (
          <span className="text-xs text-muted-foreground">{item.variantLabel}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm text-foreground">{formatPrice(item.priceAtPurchase)}</span>
        <span className="text-xs text-muted-foreground">×{item.quantity}</span>
      </div>
      {/* Thụt vào bằng đúng bề rộng ảnh (size-12 = 3rem) + khoảng cách (gap-3 = 0.75rem) để thẳng hàng với tên hàng. */}
      {footer ? <div className="basis-full pl-[3.75rem] empty:hidden">{footer}</div> : null}
    </li>
  );
}
