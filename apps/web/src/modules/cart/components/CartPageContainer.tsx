'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';

import { useCart } from '../hooks/useCart';
import { useClampCartToStock } from '../hooks/useClampCartToStock';
import { useRemoveCartItem } from '../hooks/useRemoveCartItem';
import { useUpdateCartItem } from '../hooks/useUpdateCartItem';
import type { CartLine } from '../types';
import { CART_LAYOUT_CLASS, CartSkeleton } from './CartSkeleton';
import { CartShopGroup } from './CartShopGroup';
import { CartSummary } from './CartSummary';

// Nối dữ liệu (useCart — cùng CartView cho guest lẫn đăng nhập) với UI thuần.
// Client Component vì dữ liệu cá nhân hoá theo session/localStorage, không
// cache theo URL (giống WishlistPageContainer). Đủ 3 trạng thái loading /
// error / empty (rules/frontend.md mục 10).
export function CartPageContainer() {
  const t = useTranslations('cart');
  const tCommon = useTranslations('common');
  const [appliedCode, setAppliedCode] = useState('');
  const cartQuery = useCart(appliedCode);
  // Số lượng vượt tồn kho (giỏ guest cộng dồn quá kho, shop giảm tồn...) được
  // tự hạ về đúng tồn kho khi mở giỏ, kèm 1 thông báo gộp.
  useClampCartToStock(cartQuery.cart);
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const isBusy = updateItem.isPending || removeItem.isPending;

  function handleQuantityChange(line: CartLine, quantity: number) {
    updateItem.mutate(
      { itemId: line.id, productVariantId: line.productVariantId, quantity },
      {
        onError: (error) => {
          toast.error(
            error instanceof ApiError && error.status === 409
              ? t('itemUpdateConflict')
              : t('itemUpdateError'),
          );
        },
      },
    );
  }

  function handleRemove(line: CartLine) {
    removeItem.mutate(
      { itemId: line.id, productVariantId: line.productVariantId },
      { onError: () => toast.error(t('itemRemoveError')) },
    );
  }

  if (cartQuery.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <CartSkeleton />
      </div>
    );
  }

  if (cartQuery.isError || !cartQuery.cart) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('loadError')}
        </p>
        <Button type="button" variant="outline" onClick={() => void cartQuery.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const cart = cartQuery.cart;

  if (cart.shops.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        <Button nativeButton={false} render={<Link href="/products" />}>
          {t('continueShopping')}
        </Button>
      </div>
    );
  }

  return (
    <div className={CART_LAYOUT_CLASS}>
      <div className="flex flex-col gap-4">
        {cart.shops.map((group) => (
          <CartShopGroup
            key={group.shopId}
            group={group}
            onQuantityChange={handleQuantityChange}
            onRemove={handleRemove}
            isBusy={isBusy}
          />
        ))}
      </div>
      <CartSummary
        cart={cart}
        appliedCode={appliedCode}
        voucherError={cartQuery.voucherError}
        isApplying={cartQuery.isFetching}
        onApplyVoucher={setAppliedCode}
        onClearVoucher={() => setAppliedCode('')}
      />
    </div>
  );
}
