import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopChatEntry } from './ShopChatEntry';

const auth = { user: null as { id: string } | null, isHydrating: false };
const myShop = {
  data: undefined as { id: string } | null | undefined,
  isPending: false,
};
const useMyShop = vi.fn();
const chatButton = vi.fn();

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
  ShopChatButton: (props: unknown) => {
    chatButton(props);
    return <button type="button">chat-button</button>;
  },
}));

const SHOP_ID = 'shop-1';

describe('ShopChatEntry (composition root của nút "Chat với shop" ở trang shop)', () => {
  beforeEach(() => {
    auth.user = null;
    auth.isHydrating = false;
    myShop.data = undefined;
    myShop.isPending = false;
    useMyShop.mockReset();
    chatButton.mockReset();
  });

  it('đang chờ xác định phiên (AuthHydrator): skeleton, CHƯA có nút (không nháy nút "đăng nhập" rồi đổi)', () => {
    auth.isHydrating = true;
    const { container } = render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(chatButton).not.toHaveBeenCalled();
  });

  it('khách: nút với isAuthenticated=false, không hỏi "shop của tôi" (truy vấn bị tắt)', () => {
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(chatButton).toHaveBeenCalledWith({
      shopId: SHOP_ID,
      isAuthenticated: false,
      isOwnShop: false,
    });
    expect(useMyShop).toHaveBeenCalledWith({ enabled: false });
  });

  it('đã đăng nhập, đang tải "shop của tôi": skeleton (chưa biết có phải shop của mình không)', () => {
    auth.user = { id: 'u1' };
    myShop.isPending = true;
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(useMyShop).toHaveBeenCalledWith({ enabled: true });
  });

  it('đã đăng nhập, chưa có shop (data null): nút với isOwnShop=false', () => {
    auth.user = { id: 'u1' };
    myShop.data = null;
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(chatButton).toHaveBeenCalledWith({
      shopId: SHOP_ID,
      isAuthenticated: true,
      isOwnShop: false,
    });
  });

  it('đã đăng nhập, shop của tôi là shop KHÁC: isOwnShop=false', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: 'other-shop' };
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(chatButton).toHaveBeenCalledWith(expect.objectContaining({ isOwnShop: false }));
  });

  it('đã đăng nhập, đây CHÍNH LÀ shop của tôi: isOwnShop=true (nút tự ẩn)', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: SHOP_ID };
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(chatButton).toHaveBeenCalledWith(expect.objectContaining({ isOwnShop: true }));
  });

  it('tải "shop của tôi" lỗi (data undefined, hết pending): vẫn hiện nút — BE chặn chat với shop của mình bằng 409', () => {
    auth.user = { id: 'u1' };
    myShop.data = undefined;
    myShop.isPending = false;
    render(<ShopChatEntry shopId={SHOP_ID} />);

    expect(chatButton).toHaveBeenCalledWith({
      shopId: SHOP_ID,
      isAuthenticated: true,
      isOwnShop: false,
    });
  });
});
