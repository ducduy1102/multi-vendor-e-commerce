import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';

import { useCartStore } from '../store/cart.store';
import { userCartQueryOptions } from './useCart';

// Số item hiện trên icon giỏ hàng (Header desktop + tab BottomTabBar mobile),
// cùng 1 con số cho cả 2 (Week6.md 3.7). null = chưa biết chắc (đang chờ
// hydrate hoặc tải lần đầu) — UI không hiện badge thay vì hiện "0" sai.
//   - Guest: cộng số lượng từ useCartStore, KHÔNG gọi mạng (không cần
//     POST /cart/quote chỉ để đếm; giỏ guest đã nằm sẵn ở localStorage).
//   - User đăng nhập: lấy itemCount từ giỏ BE qua cùng query key với useCart,
//     nên trang /cart không phải gọi thêm request thứ 2. Mọi thao tác giỏ đã
//     invalidate ['cart'] nên số tự cập nhật.
export function useCartCount(): number | null {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const items = useCartStore((state) => state.items);
  const hasHydrated = useCartStore((state) => state.hasHydrated);

  const userQuery = useQuery({
    ...userCartQueryOptions(user?.id ?? '', ''),
    enabled: !isHydrating && user !== null,
    select: (data) => data.cart.itemCount,
  });

  if (isHydrating) return null;
  if (user) return userQuery.data ?? null;
  if (!hasHydrated) return null;
  return items.reduce((total, item) => total + item.quantity, 0);
}
