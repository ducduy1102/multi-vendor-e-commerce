'use client';

import { MAX_CART_LINES } from '@ecommerce/types';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/modules/auth';

import { cartQueryKeys } from '../hooks/useCart';
import * as cartService from '../services/cart.service';
import { hydrateCartStore, useCartStore } from '../store/cart.store';

// Mount 1 lần ở layout (cạnh AuthHydrator), không render gì. Làm 2 việc:
//
// 1. Đọc giỏ guest từ localStorage vào useCartStore (skipHydration — xem
//    cart.store.ts) để mọi UI dựa vào items chờ được hasHydrated.
// 2. Gộp giỏ guest vào giỏ DB ngay khi biết chắc user đã đăng nhập (Week6.md
//    1.8). Đặt ở đây thay vì trong LoginFormContainer/RegisterFormContainer
//    vì đăng nhập Google OAuth quay về bằng redirect (không đi qua form nào)
//    và đăng ký không tự đăng nhập — chỉ có "user vừa xuất hiện trong
//    useAuthStore" là điểm chung của mọi đường đăng nhập, kể cả F5 lúc còn
//    sót giỏ guest từ lần merge lỗi trước.
export function CartHydrator() {
  const t = useTranslations('cart');
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const items = useCartStore((state) => state.items);
  const hasHydrated = useCartStore((state) => state.hasHydrated);
  const isMergingRef = useRef(false);

  useEffect(() => {
    void hydrateCartStore();
  }, []);

  useEffect(() => {
    if (isHydrating || !user || !hasHydrated || items.length === 0) return;
    // Chặn gọi lặp: React StrictMode (dev) chạy effect 2 lần, và POST
    // /cart/merge cộng dồn số lượng nên gọi 2 lần sẽ nhân đôi giỏ.
    if (isMergingRef.current) return;
    isMergingRef.current = true;

    cartService
      .mergeCart(items)
      .then(({ droppedLineCount }) => {
        // Sau khi đăng nhập mọi thao tác đi qua API, store không còn được
        // đọc/ghi nữa nên clear hết. Lỗi thì GIỮ NGUYÊN items để lần tải
        // sau còn thử gộp lại, không làm mất giỏ của người dùng.
        useCartStore.getState().clear();
        void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
        // Giỏ DB đã đủ MAX_CART_LINES dòng nên 1 phần giỏ guest bị bỏ khi gộp
        // (Week6.md 3.4 để ngỏ, làm ở Week7.md 3.5) — báo 1 thông báo gộp,
        // cùng cách useClampCartToStock báo "đã điều chỉnh số lượng".
        if (droppedLineCount > 0) {
          toast.info(t('mergeLinesDropped', { count: droppedLineCount, max: MAX_CART_LINES }));
        }
      })
      .catch(() => {})
      .finally(() => {
        isMergingRef.current = false;
      });
  }, [isHydrating, user, hasHydrated, items, queryClient, t]);

  return null;
}
