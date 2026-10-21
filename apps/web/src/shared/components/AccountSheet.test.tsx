import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { useUIStore } from '@/shared/store/ui.store';

import { AccountSheet } from './AccountSheet';

interface MockUser {
  name: string;
  role?: 'USER' | 'ADMIN';
}

const auth = { user: null as MockUser | null, isHydrating: false };
const sellerLink = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  // Chặn điều hướng thật của jsdom (anchor click -> "Not implemented: navigation"); vẫn chuyển
  // tiếp onClick để SheetClose đóng được Sheet.
  Link: ({ href, children, onClick, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
  useLogout: () => ({ handleLogout: vi.fn(), isLoading: false }),
}));

// Header kéo theo giỏ hàng/tìm kiếm/dropdown — AccountSheet chỉ dùng UserAvatar.
vi.mock('@/shared/components/Header', () => ({
  UserAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
}));

const chatBadges = { shopId: null as string | null, buyerUnread: 0, shopUnread: 0 };
vi.mock('@/shared/hooks/useChatBadges', () => ({ useChatBadges: () => chatBadges }));

// Huy hiệu tin nhắn được nạp bằng React.lazy (lazy-chat.tsx, để khách vãng lai không tải mã chat): khẳng định "có" dùng
// findBy, còn khẳng định "KHÔNG có" phải chờ chunk nạp xong rồi mới kiểm — không thì phủ định luôn đúng kể cả khi mã sai.
const settleLazy = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

vi.mock('@/shared/hooks/useSellerChannelLink', () => ({
  useSellerChannelLink: () => sellerLink() as unknown,
}));

vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => <button type="button">theme</button> }));
vi.mock('./LocaleSwitcher', () => ({
  LocaleSwitcher: () => <button type="button">locale</button>,
}));

const SHOP_LINK = {
  href: '/seller/products',
  icon: () => <svg data-testid="shop-icon" />,
  hasShop: true,
  label: 'Sản phẩm của tôi',
};

function openSheet() {
  useUIStore.setState({ isAccountSheetOpen: true });
  render(withIntl(<AccountSheet />));
}

describe('AccountSheet — mục "Trang cá nhân" và "Đơn hàng của tôi"', () => {
  // Theo dõi console.error ở MỌI test: Base UI chỉ báo MỖI thông điệp MỘT lần, nên test nào render
  // trước sẽ là test bắt được. Lỗi cụ thể cần chặn: `SheetClose render={<Link/>}` — Base UI coi
  // SheetClose là nút và đòi <button> (`nativeButton`), render <a> vào thì báo lỗi (hiện thành
  // "Issues" ở dev). Link trong Sheet phải là <Link> thường tự đóng Sheet qua store.
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auth.user = { name: 'Nguyễn Văn A' };
    auth.isHydrating = false;
    sellerLink.mockReturnValue(SHOP_LINK);
    Object.assign(chatBadges, { shopId: null, buyerUnread: 0, shopUnread: 0 });
    useUIStore.setState({ isAccountSheetOpen: false });
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('đã đăng nhập -> có link "Đơn hàng của tôi" trỏ /orders', () => {
    openSheet();

    expect(screen.getByRole('link', { name: 'Đơn hàng của tôi' })).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('có link "Trang cá nhân" trỏ /account, đứng ĐẦU khối link (Week9.md 6.2)', () => {
    openSheet();

    const account = screen.getByRole('link', { name: 'Trang cá nhân' });
    expect(account).toHaveAttribute('href', '/account');
    const orders = screen.getByRole('link', { name: 'Đơn hàng của tôi' });
    expect(account.compareDocumentPosition(orders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(account.parentElement).toBe(orders.parentElement);
  });

  it('bấm "Trang cá nhân" -> đóng Sheet (để thấy ngay trang đích)', async () => {
    const user = userEvent.setup();
    openSheet();

    await user.click(screen.getByRole('link', { name: 'Trang cá nhân' }));

    expect(useUIStore.getState().isAccountSheetOpen).toBe(false);
  });

  it('khách chưa đăng nhập -> KHÔNG có "Trang cá nhân"', () => {
    auth.user = null;
    openSheet();

    expect(screen.queryByRole('link', { name: 'Trang cá nhân' })).not.toBeInTheDocument();
  });

  it('đứng TRƯỚC mục kênh người bán, cả hai cùng khối', () => {
    openSheet();

    const orders = screen.getByRole('link', { name: 'Đơn hàng của tôi' });
    const shop = screen.getByRole('link', { name: 'Sản phẩm của tôi' });
    expect(orders.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(orders.parentElement).toBe(shop.parentElement);
  });

  it('chưa kịp biết shop (shopLink null) -> vẫn có "Đơn hàng của tôi", không có mục người bán', () => {
    sellerLink.mockReturnValue(null);
    openSheet();

    expect(screen.getByRole('link', { name: 'Đơn hàng của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sản phẩm của tôi' })).not.toBeInTheDocument();
  });

  it('chưa có shop -> mục người bán là "Trở thành người bán", "Đơn hàng của tôi" vẫn đứng đầu', () => {
    sellerLink.mockReturnValue({
      ...SHOP_LINK,
      href: '/seller/onboarding',
      hasShop: false,
      label: 'Trở thành người bán',
    });
    openSheet();

    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Trang cá nhân', 'Đơn hàng của tôi', 'Tin nhắn', 'Trở thành người bán']);
  });

  describe('mục "Quản trị" (Week8.md 3.9) — chỉ ADMIN', () => {
    it('ADMIN -> có link "Quản trị" trỏ /admin/shops, đứng sau mục người bán, cùng khối', () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      openSheet();

      const admin = screen.getByRole('link', { name: 'Quản trị' });
      const shop = screen.getByRole('link', { name: 'Sản phẩm của tôi' });
      expect(admin).toHaveAttribute('href', '/admin/shops');
      expect(shop.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(admin.parentElement).toBe(shop.parentElement);
    });

    it('ADMIN -> có link "Hoàn tiền" trỏ /admin/refunds, ngay sau "Quản trị", cùng khối (Week9.md 3.7)', () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      openSheet();

      const refunds = screen.getByRole('link', { name: 'Hoàn tiền' });
      const admin = screen.getByRole('link', { name: 'Quản trị' });
      expect(refunds).toHaveAttribute('href', '/admin/refunds');
      expect(
        admin.compareDocumentPosition(refunds) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(refunds.parentElement).toBe(admin.parentElement);
    });

    it('bấm "Hoàn tiền" -> đóng Sheet', async () => {
      const user = userEvent.setup();
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      openSheet();

      await user.click(screen.getByRole('link', { name: 'Hoàn tiền' }));

      expect(useUIStore.getState().isAccountSheetOpen).toBe(false);
    });

    it('USER thường / khách -> KHÔNG có "Hoàn tiền" của Admin', () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'USER' };
      openSheet();

      expect(screen.queryByRole('link', { name: 'Hoàn tiền' })).not.toBeInTheDocument();
    });

    it('bấm "Quản trị" -> đóng Sheet', async () => {
      const user = userEvent.setup();
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      openSheet();

      await user.click(screen.getByRole('link', { name: 'Quản trị' }));

      expect(useUIStore.getState().isAccountSheetOpen).toBe(false);
    });

    it('người dùng thường (USER) -> KHÔNG có link tới /admin', () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'USER' };
      openSheet();

      expect(screen.queryByRole('link', { name: 'Quản trị' })).not.toBeInTheDocument();
      expect(document.querySelector('a[href^="/admin"]')).toBeNull();
    });

    it('khách chưa đăng nhập -> không có "Quản trị"', () => {
      auth.user = null;
      openSheet();

      expect(screen.queryByRole('link', { name: 'Quản trị' })).not.toBeInTheDocument();
    });
  });

  it('khách chưa đăng nhập -> KHÔNG có "Đơn hàng của tôi", chỉ Đăng nhập/Đăng ký', () => {
    auth.user = null;
    openSheet();

    expect(screen.queryByRole('link', { name: 'Đơn hàng của tôi' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng ký' })).toBeInTheDocument();
  });

  it('đang xác định đăng nhập (isHydrating) -> chưa hiện "Đơn hàng của tôi" (tránh nháy sai trạng thái)', () => {
    auth.isHydrating = true;
    openSheet();

    expect(screen.queryByRole('link', { name: 'Đơn hàng của tôi' })).not.toBeInTheDocument();
  });

  it('bấm "Đơn hàng của tôi" -> đóng Sheet (để thấy ngay trang đích)', async () => {
    const user = userEvent.setup();
    openSheet();
    expect(useUIStore.getState().isAccountSheetOpen).toBe(true);

    await user.click(screen.getByRole('link', { name: 'Đơn hàng của tôi' }));

    expect(useUIStore.getState().isAccountSheetOpen).toBe(false);
  });

  it('link giữ vai trò "link" cho trình đọc màn hình (không bị ép thành button)', () => {
    openSheet();

    expect(screen.getByRole('link', { name: 'Đơn hàng của tôi' })).not.toHaveAttribute('role');
    expect(screen.queryByRole('button', { name: 'Đơn hàng của tôi' })).not.toBeInTheDocument();
  });

  it('vẫn còn nút Đăng xuất sau các link', () => {
    openSheet();

    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  });
});

describe('AccountSheet — tin nhắn (Week10.md 5.5, D8)', () => {
  beforeEach(() => {
    auth.user = { name: 'Nguyễn Văn A' };
    auth.isHydrating = false;
    sellerLink.mockReturnValue(SHOP_LINK);
    Object.assign(chatBadges, { shopId: null, buyerUnread: 0, shopUnread: 0 });
    useUIStore.setState({ isAccountSheetOpen: false });
  });

  const linkTo = (href: string) =>
    screen.getAllByRole('link').find((link) => link.getAttribute('href') === href);

  it('đã đăng nhập: có "Tin nhắn" trỏ /chat, đứng sau "Đơn hàng của tôi" và trước kênh người bán, cùng khối', () => {
    openSheet();

    const orders = screen.getByRole('link', { name: 'Đơn hàng của tôi' });
    const chat = linkTo('/chat');
    const shop = screen.getByRole('link', { name: 'Sản phẩm của tôi' });
    expect(chat).toHaveTextContent('Tin nhắn');
    expect(
      orders.compareDocumentPosition(chat as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (chat as Element).compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(chat?.parentElement).toBe(orders.parentElement);
  });

  it('khách chưa đăng nhập: không có "Tin nhắn"', () => {
    auth.user = null;
    openSheet();

    expect(linkTo('/chat')).toBeUndefined();
    expect(linkTo('/seller/chat')).toBeUndefined();
  });

  it('bấm "Tin nhắn" -> đóng Sheet', async () => {
    const user = userEvent.setup();
    openSheet();

    await user.click(linkTo('/chat') as Element);

    expect(useUIStore.getState().isAccountSheetOpen).toBe(false);
  });

  it('chưa đọc: huy hiệu số inline (aria-hidden) + bản chữ cho trình đọc màn hình; không chưa đọc thì không huy hiệu', async () => {
    chatBadges.buyerUnread = 6;
    openSheet();

    const chat = linkTo('/chat') as HTMLElement;
    const badge = await within(chat).findByText('6');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveClass('static', 'ml-auto');
    expect(chat).toHaveAccessibleName('Tin nhắn 6 tin chưa đọc');
  });

  it('chưa có shop: KHÔNG có "Tin nhắn của khách"', () => {
    sellerLink.mockReturnValue({ ...SHOP_LINK, hasShop: false });
    openSheet();

    expect(linkTo('/seller/chat')).toBeUndefined();
  });

  it('có shop: có "Tin nhắn của khách" trỏ /seller/chat với huy hiệu RIÊNG của shop, tách khỏi huy hiệu người mua', async () => {
    Object.assign(chatBadges, { buyerUnread: 1, shopUnread: 9 });
    openSheet();

    const seller = linkTo('/seller/chat') as HTMLElement;
    expect(seller).toHaveTextContent('Tin nhắn của khách');
    expect(await within(seller).findByText('9')).toBeInTheDocument();
    const buyer = linkTo('/chat') as HTMLElement;
    expect(await within(buyer).findByText('1')).toBeInTheDocument();
  });

  it('tin chưa đọc ở hộp thư SHOP nổi lên ngay trên tab "Tài khoản" (không cần mở Sheet)', async () => {
    Object.assign(chatBadges, { shopUnread: 3 });
    useUIStore.setState({ isAccountSheetOpen: false });
    render(withIntl(<AccountSheet />));

    const trigger = screen.getByRole('button', { name: /Tài khoản/ });
    expect(await within(trigger).findByText('3')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAccessibleName(/3 tin chưa đọc/);
  });

  it('không có tin chưa đọc ở hộp thư shop: tab không có huy hiệu', async () => {
    Object.assign(chatBadges, { shopUnread: 0 });
    render(withIntl(<AccountSheet />));
    await settleLazy();

    const trigger = screen.getByRole('button', { name: /Tài khoản/ });
    expect(trigger.querySelector('.bg-primary')).toBeNull();
  });
});
