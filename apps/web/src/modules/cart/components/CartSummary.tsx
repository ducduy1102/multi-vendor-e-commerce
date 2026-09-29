'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import type { CartView } from '../types';
import { classifyVoucherError, type VoucherErrorState } from '../voucher-error';

interface CartSummaryProps {
  cart: CartView;
  // Mã đang được áp (đã bấm "Áp dụng"), '' nếu chưa có.
  appliedCode: string;
  // Lý do BE từ chối mã, dạng code/details máy đọc được (null nếu mã hợp lệ / chưa nhập).
  voucherError: VoucherErrorState | null;
  isApplying: boolean;
  onApplyVoucher: (code: string) => void;
  onClearVoucher: () => void;
}

// Cột tóm tắt bên phải: ô mã giảm giá (đúng 1 mã, Week6.md 1.12), tạm tính,
// giảm giá, tổng cộng. Nút thanh toán là Link tới /checkout (Week7.md 3.5,
// chuyển giao #8) — disabled khi giỏ không còn item nào khả dụng; guest bấm
// vào bị proxy.ts tự đẩy sang /login?next=/checkout (Week7.md 3.2). Số giảm
// dùng text-success (semantic, teal) — dự án chưa có token màu cam "accent"
// (--accent của shadcn là xám trung tính), không tự thêm token mới ở bước này.
export function CartSummary({
  cart,
  appliedCode,
  voucherError,
  isApplying,
  onApplyVoucher,
  onClearVoucher,
}: CartSummaryProps) {
  const t = useTranslations('cart');
  // Key của errorInfo là key ĐẦY ĐỦ (kèm namespace, vd 'cart.voucherNotFound') —
  // ERROR_CODE_MESSAGE_KEYS trải trên nhiều namespace nên cần translator toàn cục,
  // giống useApiErrorMessage/useValidationMessage (shared/hooks/useValidationMessage.ts).
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const inputId = useId();
  const errorId = useId();
  const [codeInput, setCodeInput] = useState(appliedCode);

  const discount = cart.discount;
  // Item không khả dụng (Week6.md 1.9) vẫn có thể còn nguyên trong giỏ — chặn thanh toán khi
  // KHÔNG còn item nào khả dụng, thay vì chỉ dựa vào shops.length (CartPageContainer đã lo
  // trường hợp giỏ rỗng hẳn ở nhánh empty state riêng).
  const hasAvailableItem = cart.shops.some((shop) => shop.items.some((item) => item.isAvailable));
  const errorInfo = voucherError && appliedCode ? classifyVoucherError(voucherError) : null;
  const shopName = discount?.shopId
    ? cart.shops.find((shop) => shop.shopId === discount.shopId)?.shopName
    : undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeInput.trim();
    if (code) onApplyVoucher(code);
  }

  function handleClear() {
    setCodeInput('');
    onClearVoucher();
  }

  return (
    <aside
      aria-label={t('summaryTitle')}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 lg:sticky lg:top-24"
    >
      <h2 className="text-base font-semibold text-foreground">{t('summaryTitle')}</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{t('voucherLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value)}
            placeholder={t('voucherPlaceholder')}
            autoComplete="off"
            maxLength={32}
            aria-invalid={errorInfo ? true : undefined}
            aria-describedby={errorInfo ? errorId : undefined}
          />
          <Button type="submit" variant="outline" disabled={isApplying || !codeInput.trim()}>
            {t('voucherApply')}
          </Button>
        </div>
        {errorInfo ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {tGlobal(errorInfo.key, {
              amount:
                errorInfo.minAmount !== undefined ? formatPrice(String(errorInfo.minAmount)) : '',
            })}
          </p>
        ) : null}
        {discount && !errorInfo ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-sm">
            <span className="text-success">
              {shopName
                ? t('voucherAppliedShop', { code: discount.code, shop: shopName })
                : t('voucherApplied', { code: discount.code })}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleClear}>
              <XIcon />
              <span className="sr-only">{t('voucherRemove')}</span>
            </Button>
          </div>
        ) : null}
      </form>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t('subtotalLabel')}</dt>
          <dd className="text-foreground">{formatPrice(cart.subtotal)}</dd>
        </div>
        {discount ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('discountLabel')}</dt>
            <dd className="font-medium text-success">-{formatPrice(discount.amount)}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-border pt-2 text-base">
          <dt className="font-semibold text-foreground">{t('grandTotalLabel')}</dt>
          <dd className="font-semibold text-foreground">{formatPrice(cart.grandTotal)}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        {hasAvailableItem ? (
          <Button nativeButton={false} render={<Link href="/checkout" />}>
            {t('checkout')}
          </Button>
        ) : (
          <Button type="button" disabled>
            {t('checkout')}
          </Button>
        )}
      </div>
    </aside>
  );
}
