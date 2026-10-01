import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';
import { getErrorCode } from '@/shared/lib/error-codes';

import * as cartService from '../services/cart.service';
import { useCartStore } from '../store/cart.store';
import type { CartItemInput, CartView } from '../types';
import type { VoucherErrorState } from '../voucher-error';

// Key theo "ai đang xem": mỗi user 1 scope riêng (user:<id>) và guest 1 scope
// riêng, để dữ liệu giỏ của user A không bao giờ lộ sang user B hoặc guest
// khi đổi tài khoản trên cùng trình duyệt. Mọi key đều bắt đầu bằng 'cart' để
// mutation invalidate được hết trong 1 lần.
export const cartQueryKeys = {
  all: ['cart'] as const,
  user: (userId: string, voucherCode: string) => ['cart', `user:${userId}`, voucherCode] as const,
  guest: (voucherCode: string, items: CartItemInput[]) =>
    ['cart', 'guest', voucherCode, items] as const,
};

export const EMPTY_CART_VIEW: CartView = {
  shops: [],
  subtotal: '0',
  discount: null,
  grandTotal: '0',
  itemCount: 0,
};

interface CartQueryData {
  cart: CartView;
  // Lý do BE từ chối mã (hết hạn, hết lượt, dưới mức tối thiểu...) dạng
  // code/details máy đọc được (Week7.md 1.16) — CartSummary dịch qua
  // classifyVoucherError, không còn so message theo chuỗi.
  voucherError: VoucherErrorState | null;
}

// Mã sai không được làm hỏng cả trang giỏ: BE trả 400/404 cho mã không áp dụng
// được, ta lấy lại giỏ KHÔNG kèm mã và báo lý do riêng thay vì để cả query
// lỗi. Lỗi khác (401, 5xx, mất mạng) vẫn ném ra như bình thường.
async function fetchWithVoucherFallback(
  fetchCart: (voucherCode?: string) => Promise<CartView>,
  voucherCode: string,
): Promise<CartQueryData> {
  if (!voucherCode) {
    return { cart: await fetchCart(), voucherError: null };
  }
  try {
    return { cart: await fetchCart(voucherCode), voucherError: null };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
      return {
        cart: await fetchCart(),
        voucherError: { code: getErrorCode(error), details: error.details },
      };
    }
    throw error;
  }
}

// Lỗi 4xx là lỗi của request (chưa đăng nhập, dữ liệu sai), thử lại vô ích.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

// Option của query giỏ hàng của USER đã đăng nhập — dùng chung giữa useCart
// (trang /cart) và useCartCount (badge Header/BottomTabBar) để cả hai chung 1
// key + 1 hàm fetch: cache dùng chung, /cart không phải gọi thêm request thứ 2
// chỉ vì badge đã tải rồi (badge chỉ khác ở `select`).
export function userCartQueryOptions(userId: string, voucherCode: string) {
  return {
    queryKey: cartQueryKeys.user(userId, voucherCode),
    queryFn: () => fetchWithVoucherFallback((voucher) => cartService.getCart(voucher), voucherCode),
    retry: shouldRetry,
  };
}

// Hook hợp nhất (Week6.md 1.7): user đã đăng nhập gọi GET /cart, guest đọc
// useCartStore rồi gọi POST /cart/quote — cả 2 nhánh trả về CÙNG shape
// CartView nên component /cart không cần biết đang ở nhánh nào. Chờ
// isHydrating (auth) và hasHydrated (giỏ guest) trước khi chọn nhánh, tránh
// gọi nhầm API/nháy giỏ trống trong 1 nhịp.
export function useCart(voucherCode = '') {
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const items = useCartStore((state) => state.items);
  const hasHydrated = useCartStore((state) => state.hasHydrated);

  const code = voucherCode.trim();
  const isReady = !isHydrating && (user !== null || hasHydrated);
  // Giỏ guest trống không cần gọi BE, trả luôn giỏ rỗng.
  const isGuestEmpty = user === null && items.length === 0;
  const scope = user ? `user:${user.id}` : 'guest';

  const userOptions = user ? userCartQueryOptions(user.id, code) : null;

  const query = useQuery({
    queryKey: userOptions ? userOptions.queryKey : cartQueryKeys.guest(code, items),
    queryFn: userOptions
      ? userOptions.queryFn
      : () => fetchWithVoucherFallback((voucher) => cartService.quoteCart(items, voucher), code),
    enabled: isReady && !isGuestEmpty,
    // Giữ dữ liệu cũ khi số lượng/mã đổi để giỏ không nháy skeleton mỗi lần
    // bấm +/-, NHƯNG chỉ trong cùng 1 scope — không bao giờ mượn dữ liệu của
    // scope khác (vd giỏ user vừa đăng xuất hiện cho guest).
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === scope ? previousData : undefined,
    retry: shouldRetry,
  });

  const showEmpty = isReady && isGuestEmpty;

  return {
    cart: showEmpty ? EMPTY_CART_VIEW : query.data?.cart,
    voucherError: showEmpty ? null : (query.data?.voucherError ?? null),
    // Chưa có dữ liệu để hiển thị (đang chờ hydrate hoặc lần tải đầu).
    isPending: !isReady || (!isGuestEmpty && query.isPending),
    isFetching: query.isFetching,
    isError: !showEmpty && query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
