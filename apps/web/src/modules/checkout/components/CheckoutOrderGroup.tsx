'use client';

import { ORDER_NOTE_MAX_LENGTH } from '@ecommerce/types';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { formatPrice } from '@/modules/product';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import type { CheckoutPreviewOrder } from '../types';
import { CHECKOUT_SHOP_NOTE_CLASS } from './CheckoutSkeleton';

interface CheckoutOrderGroupProps {
  order: CheckoutPreviewOrder;
  // Lời nhắn đang gõ cho shop này (Week8.md 3B). State do CheckoutContainer giữ theo `shopId` — nằm
  // ngoài khối này để sống qua lần tải lại xem trước (đổi địa chỉ/giá đổi) khi khối được dựng lại.
  note: string;
  onNoteChange: (note: string) => void;
}

// 1 khối / 1 shop tương lai sẽ là 1 Order (rules/frontend.md mục 7 "Cart multi-vendor"): danh
// sách sản phẩm CHỈ ĐỌC (không sửa số lượng/xoá ở đây — /checkout không phải /cart) + phí ship
// riêng + giảm giá phân bổ + thành tiền của riêng shop này + ô lời nhắn RIÊNG cho shop này (mỗi
// đơn một lời nhắn, shop khác không thấy). Component THUẦN, mọi số tiền do POST /checkout/preview
// (2.7b) tính sẵn — không tự cộng ở FE (Week6.md 1.7/3.4).
export function CheckoutOrderGroup({ order, note, onNoteChange }: CheckoutOrderGroupProps) {
  const t = useTranslations('checkout');
  const hasDiscount = Number(order.discountAmount) > 0;
  // Nhiều khối cùng trang ⇒ id phải duy nhất theo từng khối (nhãn + bộ đếm gắn với đúng ô nhập).
  const noteId = useId();
  const counterId = `${noteId}-counter`;

  return (
    <section
      aria-label={order.shopName}
      className="overflow-hidden rounded-lg border border-border bg-background"
    >
      <h2 className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground sm:px-4">
        {order.shopName}
      </h2>
      <ul className="divide-y divide-border">
        {order.items.map((line) => (
          <li
            key={line.productVariantId}
            className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm sm:px-4"
          >
            <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
              <span className="line-clamp-2 font-medium text-foreground">{line.productName}</span>
              {line.attributes.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {line.attributes
                    .map((attribute) => `${attribute.name}: ${attribute.value}`)
                    .join(' · ')}
                </span>
              ) : null}
            </div>
            <span className="text-muted-foreground">×{line.quantity}</span>
            <span className="w-24 text-right font-medium text-foreground">
              {formatPrice(line.lineTotal)}
            </span>
          </li>
        ))}
      </ul>
      <div className={CHECKOUT_SHOP_NOTE_CLASS}>
        <Label htmlFor={noteId} className="text-sm text-muted-foreground">
          {t('shopNoteLabel')}
        </Label>
        {/* maxLength chặn gõ/dán quá giới hạn ngay ở trình duyệt; BE vẫn kiểm lại (400 nếu vượt). */}
        <Textarea
          id={noteId}
          value={note}
          maxLength={ORDER_NOTE_MAX_LENGTH}
          className="max-h-40"
          placeholder={t('shopNotePlaceholder')}
          aria-describedby={counterId}
          onChange={(event) => onNoteChange(event.target.value)}
        />
        <p id={counterId} className="self-end text-xs text-muted-foreground tabular-nums">
          {t('shopNoteCounter', { count: note.length, max: ORDER_NOTE_MAX_LENGTH })}
        </p>
      </div>
      <dl className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm sm:px-4">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('orderSubtotalLabel')}</dt>
          <dd className="text-foreground">{formatPrice(order.subtotal)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('orderShippingFeeLabel')}</dt>
          <dd className="text-foreground">
            {order.shippingFee !== null ? formatPrice(order.shippingFee) : '—'}
          </dd>
        </div>
        {hasDiscount ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('orderDiscountLabel')}</dt>
            <dd className="font-medium text-success">-{formatPrice(order.discountAmount)}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-border pt-1 font-semibold">
          <dt className="text-foreground">{t('orderTotalLabel')}</dt>
          <dd className="text-foreground">
            {order.total !== null ? formatPrice(order.total) : '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
