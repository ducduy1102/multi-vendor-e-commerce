import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRealtimeSync } from './ChatRealtimeSync';

const auth = { user: null as { id: string } | null };
const myShop = { data: undefined as { id: string } | null | undefined };
const sync = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/shop', () => ({ useMyShop: () => myShop }));
vi.mock('@/modules/chat', () => ({
  useChatRealtimeSync: (scope: unknown, options: unknown) => sync(scope, options) as void,
}));

describe('ChatRealtimeSync', () => {
  beforeEach(() => {
    auth.user = null;
    myShop.data = undefined;
    sync.mockReset();
  });

  it('không render gì ra giao diện', () => {
    const { container } = render(<ChatRealtimeSync />);

    expect(container).toBeEmptyDOMElement();
  });

  it('khách vãng lai: cả hai phạm vi bị tắt', () => {
    render(<ChatRealtimeSync />);

    expect(sync).toHaveBeenCalledWith({ role: 'BUYER' }, { enabled: false });
    expect(sync).toHaveBeenCalledWith({ role: 'SHOP', shopId: '' }, { enabled: false });
  });

  it('đã đăng nhập, chưa có shop: bật hộp thư người mua, hộp thư shop vẫn tắt', () => {
    auth.user = { id: 'u1' };
    myShop.data = null;
    render(<ChatRealtimeSync />);

    expect(sync).toHaveBeenCalledWith({ role: 'BUYER' }, { enabled: true });
    expect(sync).toHaveBeenCalledWith({ role: 'SHOP', shopId: '' }, { enabled: false });
  });

  it('có shop: bật cả hai, phạm vi shop mang đúng shopId', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: 'shop-1' };
    render(<ChatRealtimeSync />);

    expect(sync).toHaveBeenCalledWith({ role: 'BUYER' }, { enabled: true });
    expect(sync).toHaveBeenCalledWith({ role: 'SHOP', shopId: 'shop-1' }, { enabled: true });
  });

  it('đăng xuất khi "shop của tôi" còn trong cache: tắt cả hai (không nghe sự kiện của người trước)', () => {
    auth.user = null;
    myShop.data = { id: 'shop-1' };
    render(<ChatRealtimeSync />);

    expect(sync).toHaveBeenCalledWith({ role: 'BUYER' }, { enabled: false });
    expect(sync).toHaveBeenCalledWith({ role: 'SHOP', shopId: '' }, { enabled: false });
  });
});
