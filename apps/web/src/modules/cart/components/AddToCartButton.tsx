'use client';

import { MAX_CART_LINES } from '@ecommerce/types';
import { ShoppingCartIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/modules/auth';
import { Button } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';
import { getErrorCode, getErrorDetails } from '@/shared/lib/error-codes';

import { useAddToCart } from '../hooks/useAddToCart';
import { useCartStore } from '../store/cart.store';
import { QuantityStepper } from './QuantityStepper';

interface AddToCartButtonProps {
  // null khi khách chưa chọn đủ phân loại (chưa khớp đúng 1 variant).
  productVariantId: string | null;
  // Tồn kho của variant đang chọn (0 nếu chưa chọn hoặc variant đã tắt).
  stock: number;
}

// Nút "Thêm vào giỏ hàng" tự chứa (tự gọi hook/toast) để trang chi tiết sản
// phẩm dùng qua barrel như WishlistButton — modules/cart không biết gì về
// modules/product, variant đang chọn được truyền vào qua props. Disable khi
// chưa chọn đủ combo hoặc combo đó hết hàng (Week6.md 3.5) — hết hàng theo
// từng combo, không disable cả sản phẩm (rules/frontend.md mục 7).
export function AddToCartButton({ productVariantId, stock }: AddToCartButtonProps) {
  const t = useTranslations('cart');
  const hintId = useId();
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const { mutate, isPending } = useAddToCart();
  const isLoggedIn = useAuthStore((state) => state.user !== null);
  // Số cái variant này ĐÃ có trong giỏ guest (localStorage). Guest không có
  // API kiểm tồn kho lúc thêm nên phải tự trừ số đã có, nếu không thêm nhiều
  // lần sẽ cộng dồn vượt kho (vd kho 15, thêm 15 rồi thêm 1 nữa thành 16). Đã
  // đăng nhập thì BE tự chặn (409), không cần tự trừ ở đây.
  const guestQuantityInCart = useCartStore((state) =>
    isLoggedIn || !productVariantId
      ? 0
      : (state.items.find((item) => item.productVariantId === productVariantId)?.quantity ?? 0),
  );
  // Số DÒNG (variant khác nhau) đang có trong giỏ guest — dùng để tự áp trần MAX_CART_LINES phía
  // client (Week7.md 3.5/1.12), vì guest không có API để BE tự chặn như user đã đăng nhập.
  const guestLineCount = useCartStore((state) => (isLoggedIn ? 0 : state.items.length));

  const hasSelection = productVariantId !== null;
  const isOutOfStock = hasSelection && stock < 1;
  const remaining = stock - guestQuantityInCart;
  const isMaxInCart = hasSelection && !isOutOfStock && remaining < 1;
  // Chỉ chặn khi đây là DÒNG MỚI (variant chưa có trong giỏ) — cộng dồn vào dòng có sẵn không bị
  // giới hạn bởi trần này (đúng quy ước MAX_CART_LINES ở packages/types/src/cart.ts).
  const isNewGuestLine = !isLoggedIn && guestQuantityInCart === 0;
  const guestCartFull =
    hasSelection &&
    !isOutOfStock &&
    !isMaxInCart &&
    isNewGuestLine &&
    guestLineCount >= MAX_CART_LINES;
  const canAdd = hasSelection && !isOutOfStock && !isMaxInCart && !guestCartFull;
  // Đổi sang combo tồn kho ít hơn thì kẹp số lượng xuống, không giữ số cũ vượt kho.
  const quantity = Math.min(requestedQuantity, Math.max(remaining, 1));
  const hint = !hasSelection
    ? t('selectVariantHint')
    : isOutOfStock
      ? t('outOfStock')
      : isMaxInCart
        ? t('maxInCartHint', { count: guestQuantityInCart })
        : guestCartFull
          ? t('cartFull', { max: MAX_CART_LINES })
          : null;

  function errorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code === 'CART_FULL') {
        const maxLines = getErrorDetails(error.details, 'CART_FULL')?.maxLines ?? MAX_CART_LINES;
        return t('cartFull', { max: maxLines });
      }
      if (code === 'CART_OWN_SHOP_ITEM') return t('errorOwnShopItem');
      if (error.status === 409) return t('addToCartConflict');
      if (error.status === 401) return t('addToCartUnauthorized');
    }
    return t('addToCartError');
  }

  function handleAdd() {
    if (!productVariantId) return;
    mutate(
      { productVariantId, quantity },
      {
        onSuccess: () => {
          toast.success(t('addToCartSuccess'));
          setRequestedQuantity(1);
        },
        onError: (error) => {
          toast.error(errorMessage(error));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={quantity}
          onChange={setRequestedQuantity}
          max={Math.max(remaining, 1)}
          disabled={!canAdd || isPending}
        />
        <Button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd || isPending}
          aria-describedby={hint ? hintId : undefined}
        >
          <ShoppingCartIcon />
          {t('addToCart')}
        </Button>
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
