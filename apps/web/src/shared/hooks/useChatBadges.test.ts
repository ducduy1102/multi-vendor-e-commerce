import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatBadges } from './useChatBadges';

const auth = { user: null as { id: string } | null };
const myShop = { data: undefined as { id: string } | null | undefined };
const unreadCount = vi.fn();
const useMyShop = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/shop', () => ({
  useMyShop: (options: unknown) => {
    useMyShop(options);
    return myShop;
  },
}));
vi.mock('@/modules/chat', () => ({
  useChatUnreadCount: (scope: unknown, options: unknown) =>
    unreadCount(scope, options) as { data: number | undefined },
}));

const BUYER = { role: 'BUYER' };

describe('useChatBadges', () => {
  beforeEach(() => {
    auth.user = null;
    myShop.data = undefined;
    unreadCount.mockReset().mockReturnValue({ data: undefined });
    useMyShop.mockReset();
  });

  it('khách vãng lai: mọi số là 0 và CẢ HAI truy vấn bị tắt (không gọi API khi chưa có phiên)', () => {
    unreadCount.mockReturnValue({ data: 9 }); // dữ liệu còn sót trong cache cũng không được lộ ra
    const { result } = renderHook(() => useChatBadges());

    expect(result.current).toEqual({ shopId: null, buyerUnread: 0, shopUnread: 0 });
    expect(unreadCount).toHaveBeenCalledWith(BUYER, { enabled: false });
    expect(unreadCount).toHaveBeenCalledWith({ role: 'SHOP', shopId: '' }, { enabled: false });
    expect(useMyShop).toHaveBeenCalledWith({ enabled: false });
  });

  it('đã đăng nhập, chưa có shop: số của người mua, truy vấn shop vẫn tắt', () => {
    auth.user = { id: 'u1' };
    myShop.data = null;
    unreadCount.mockImplementation((scope: { role: string }) => ({
      data: scope.role === 'BUYER' ? 4 : 99,
    }));
    const { result } = renderHook(() => useChatBadges());

    expect(result.current).toEqual({ shopId: null, buyerUnread: 4, shopUnread: 0 });
    expect(unreadCount).toHaveBeenCalledWith(BUYER, { enabled: true });
    expect(unreadCount).toHaveBeenCalledWith({ role: 'SHOP', shopId: '' }, { enabled: false });
  });

  it('có shop: thêm số của SHOP, truy vấn shop bật với đúng shopId, hai số tách bạch', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: 'shop-1' };
    unreadCount.mockImplementation((scope: { role: string }) => ({
      data: scope.role === 'BUYER' ? 2 : 7,
    }));
    const { result } = renderHook(() => useChatBadges());

    expect(result.current).toEqual({ shopId: 'shop-1', buyerUnread: 2, shopUnread: 7 });
    expect(unreadCount).toHaveBeenCalledWith({ role: 'SHOP', shopId: 'shop-1' }, { enabled: true });
  });

  it('chưa tải xong (data undefined) ⇒ 0, không NaN/undefined', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: 'shop-1' };
    const { result } = renderHook(() => useChatBadges());

    expect(result.current).toEqual({ shopId: 'shop-1', buyerUnread: 0, shopUnread: 0 });
  });

  it('đăng xuất khi "shop của tôi" còn trong cache ⇒ không còn shopId (không lộ shop của người trước)', () => {
    auth.user = null;
    myShop.data = { id: 'shop-1' };
    unreadCount.mockReturnValue({ data: 5 });
    const { result } = renderHook(() => useChatBadges());

    expect(result.current).toEqual({ shopId: null, buyerUnread: 0, shopUnread: 0 });
  });
});
