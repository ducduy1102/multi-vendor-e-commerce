'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';

import type { CheckoutPreview, PaymentMethod } from '../types';
import { PaymentMethodSelector } from './PaymentMethodSelector';

export interface OutOfStockItem {
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  available: number;
}

interface CheckoutSummaryProps {
  preview: CheckoutPreview;
  paymentMethod: PaymentMethod | null;
  onSelectPaymentMethod: (method: PaymentMethod) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  submitError: string | null;
  outOfStockItems: OutOfStockItem[];
  pendingGroupIds: string[];
}

// Cột tóm tắt bên phải (giống CartSummary): tổng tiền hàng/phí ship/giảm giá/tổng thanh toán từ
// preview (Week6.md 1.7 — FE không tự tính), chọn phương thức thanh toán, các cảnh báo trước khi
// đặt hàng (item không khả dụng, vượt tồn kho, hết hàng lúc đặt, quá nhiều đơn chờ thanh toán) và
// nút "Đặt hàng". Component THUẦN — mọi state/side-effect do CheckoutContainer quản lý.
export function CheckoutSummary({
  preview,
  paymentMethod,
  onSelectPaymentMethod,
  onSubmit,
  isSubmitting,
  canSubmit,
  submitError,
  outOfStockItems,
  pendingGroupIds,
}: CheckoutSummaryProps) {
  const t = useTranslations('checkout');
  const hasDiscount = Number(preview.discountTotal) > 0;

  return (
    <aside
      aria-label={t('summarySectionTitle')}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 lg:sticky lg:top-24"
    >
      <h2 className="text-base font-semibold text-foreground">{t('summarySectionTitle')}</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('summarySubtotalLabel')}</dt>
          <dd className="text-foreground">{formatPrice(preview.subtotal)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('summaryShippingLabel')}</dt>
          <dd className="text-foreground">
            {preview.shippingTotal !== null ? formatPrice(preview.shippingTotal) : '—'}
          </dd>
        </div>
        {hasDiscount ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('summaryDiscountLabel')}</dt>
            <dd className="font-medium text-success">-{formatPrice(preview.discountTotal)}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-border pt-2 text-base">
          <dt className="font-semibold text-foreground">{t('summaryGrandTotalLabel')}</dt>
          <dd className="font-semibold text-foreground">
            {preview.grandTotal !== null ? formatPrice(preview.grandTotal) : '—'}
          </dd>
        </div>
      </dl>

      {preview.needsAddress ? (
        <p className="text-xs text-muted-foreground">{t('needsAddressNotice')}</p>
      ) : null}

      <PaymentMethodSelector
        methods={preview.paymentMethods}
        selected={paymentMethod}
        onSelect={onSelectPaymentMethod}
      />

      {preview.excludedItems.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-2.5 py-2 text-xs">
          <p className="font-medium text-foreground">{t('excludedItemsTitle')}</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {preview.excludedItems.map((item) => (
              <li key={item.cartItemId}>
                {item.name} — {t('excludedItemReason')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.blockingIssues.length > 0 ? (
        <Alert variant="destructive">
          <p className="font-medium">{t('blockingIssuesTitle')}</p>
          <p>{t('blockingIssuesMessage')}</p>
          <Link href="/cart" className="underline">
            {t('backToCartLink')}
          </Link>
        </Alert>
      ) : null}

      {outOfStockItems.length > 0 ? (
        <Alert variant="destructive">
          <p className="font-medium">{t('outOfStockItemsTitle')}</p>
          <ul className="list-inside list-disc">
            {outOfStockItems.map((item) => (
              <li key={item.productVariantId}>
                {item.productName}
                {item.variantLabel ? ` (${item.variantLabel})` : ''} —{' '}
                {t('outOfStockItemAvailable', { available: item.available })}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {pendingGroupIds.length > 0 ? (
        <Alert variant="destructive">
          <p className="font-medium">{t('pendingCheckoutsTitle')}</p>
          <ul className="list-inside list-disc">
            {pendingGroupIds.map((groupId, index) => (
              <li key={groupId}>
                <Link
                  href={{ pathname: '/checkout/result', query: { groupId } }}
                  className="underline"
                >
                  {t('pendingCheckoutLink', { index: index + 1 })}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {submitError ? <Alert variant="destructive">{submitError}</Alert> : null}

      <Button type="button" onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? t('placeOrderSubmitting') : t('placeOrderButton')}
      </Button>
    </aside>
  );
}
