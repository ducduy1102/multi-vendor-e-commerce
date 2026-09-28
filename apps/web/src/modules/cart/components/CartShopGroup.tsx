'use client';

import { useTranslations } from 'next-intl';

import { formatPrice } from '@/modules/product';

import type { CartLine, CartShopGroup as CartShopGroupData } from '../types';
import { CartItemRow } from './CartItemRow';

interface CartShopGroupProps {
  group: CartShopGroupData;
  onQuantityChange: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  isBusy: boolean;
}

// 1 khối / 1 shop (rules/frontend.md mục 7 "Cart multi-vendor"): tên shop,
// các dòng hàng của shop đó và subtotal RIÊNG của shop (chỉ tính item khả
// dụng — BE đã tính sẵn, FE không tự cộng).
export function CartShopGroup({ group, onQuantityChange, onRemove, isBusy }: CartShopGroupProps) {
  const t = useTranslations('cart');

  return (
    <section
      aria-label={group.shopName}
      className="overflow-hidden rounded-lg border border-border bg-background"
    >
      <h2 className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground sm:px-4">
        {group.shopName}
      </h2>
      <ul className="divide-y divide-border">
        {group.items.map((line) => (
          <CartItemRow
            key={line.productVariantId}
            line={line}
            onQuantityChange={onQuantityChange}
            onRemove={onRemove}
            isBusy={isBusy}
          />
        ))}
      </ul>
      <p className="flex items-center justify-between border-t border-border px-3 py-2 text-sm sm:px-4">
        <span className="text-muted-foreground">{t('shopSubtotal')}</span>
        <span className="font-semibold text-foreground">{formatPrice(group.subtotal)}</span>
      </p>
    </section>
  );
}
