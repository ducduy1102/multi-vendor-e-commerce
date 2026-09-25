import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import type { CartLine, CartView } from '../types';
import { useUpdateCartItem } from './useUpdateCartItem';

function clampKey(line: CartLine): string {
  return `${line.productVariantId}:${line.quantity}:${line.stock}`;
}

// Dòng còn bán, còn hàng nhưng số lượng trong giỏ đang VƯỢT tồn kho (vd giỏ
// guest lỡ cộng dồn quá kho, hoặc shop giảm tồn sau khi đã thêm). Dòng hết
// hàng hẳn (stock 0) KHÔNG nằm trong này: không có số hợp lệ để hạ xuống, giữ
// nguyên kèm cảnh báo "hết hàng" để người dùng tự quyết (xoá hay chờ).
function findOverStockLines(cart: CartView): CartLine[] {
  return cart.shops
    .flatMap((group) => group.items)
    .filter((line) => line.isAvailable && line.stock >= 1 && line.quantity > line.stock);
}

// Tự hạ số lượng vượt kho về đúng tồn kho khi mở giỏ, rồi báo 1 thông báo
// gộp — cách các sàn thường làm ("số lượng đã được điều chỉnh"), thay vì bắt
// người dùng tự bấm "-" nhiều lần. Chạy cho cả guest lẫn user đăng nhập (hook
// cập nhật tự chọn nhánh). Mỗi (variant, số lượng, tồn kho) chỉ thử 1 lần
// trong 1 lần mở trang: cập nhật lỗi thì KHÔNG thử lại vô hạn (vẫn còn cảnh
// báo trên dòng để người dùng tự xử lý), và giỏ cũ đang giữ trong lúc tải lại
// không làm gọi trùng.
export function useClampCartToStock(cart: CartView | undefined) {
  const t = useTranslations('cart');
  const { mutateAsync } = useUpdateCartItem();
  const handledRef = useRef(new Set<string>());

  useEffect(() => {
    if (!cart) return;
    const pending = findOverStockLines(cart).filter(
      (line) => !handledRef.current.has(clampKey(line)),
    );
    if (pending.length === 0) return;
    for (const line of pending) {
      handledRef.current.add(clampKey(line));
    }

    void Promise.allSettled(
      pending.map((line) =>
        mutateAsync({
          itemId: line.id,
          productVariantId: line.productVariantId,
          quantity: line.stock,
        }),
      ),
    ).then((results) => {
      const adjusted = results.filter((result) => result.status === 'fulfilled').length;
      if (adjusted > 0) {
        toast.info(t('quantityAdjusted', { count: adjusted }));
      }
    });
  }, [cart, mutateAsync, t]);
}
