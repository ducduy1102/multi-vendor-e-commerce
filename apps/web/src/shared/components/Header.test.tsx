import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { Header } from './Header';

interface MockUser {
  name: string;
  role?: 'USER' | 'ADMIN';
}

const auth = { user: null as MockUser | null, isHydrating: false };
const sellerLink = vi.fn();
const pathname = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => pathname() as string,
}));

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
  LogoutButton: () => <button type="button">Đăng xuất</button>,
}));

vi.mock('@/modules/cart', () => ({
  CartCountBadge: () => null,
  useCartCount: () => null,
}));

const chatBadges = { shopId: null as string | null, buyerUnread: 0, shopUnread: 0 };
vi.mock('@/shared/hooks/useChatBadges', () => ({ useChatBadges: () => chatBadges }));

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

async function openAccountMenu() {
  const user = userEvent.setup();
  render(withIntl(<Header />));
  await user.click(screen.getByRole('button', { name: /Nguyễn Văn A/ }));
  return screen.findByRole('menu');
}

describe('Header — menu tài khoản (desktop)', () => {
  beforeEach(() => {
    auth.user = { name: 'Nguyễn Văn A' };
    auth.isHydrating = false;
    sellerLink.mockReturnValue(SHOP_LINK);
    pathname.mockReturnValue('/');
    Object.assign(chatBadges, { shopId: null, buyerUnread: 0, shopUnread: 0 });
  });

  it('đã đăng nhập -> menu có "Đơn hàng của tôi" trỏ /orders', async () => {
    await openAccountMenu();

    expect(screen.getByRole('menuitem', { name: 'Đơn hàng của tôi' })).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('thứ tự: Trang cá nhân -> Đơn hàng của tôi -> kênh người bán -> Đăng xuất', async () => {
    const menu = await openAccountMenu();

    const labels = Array.from(menu.querySelectorAll('[role="menuitem"], button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Trang cá nhân',
      'Đơn hàng của tôi',
      'Tin nhắn',
      'Sản phẩm của tôi',
      'Đăng xuất',
    ]);
  });

  it('chưa có shop -> mục người bán là "Trở thành người bán", "Đơn hàng của tôi" vẫn đứng đầu', async () => {
    sellerLink.mockReturnValue({
      ...SHOP_LINK,
      href: '/seller/onboarding',
      hasShop: false,
      label: 'Trở thành người bán',
    });
    const menu = await openAccountMenu();

    const labels = Array.from(menu.querySelectorAll('[role="menuitem"], button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Trang cá nhân',
      'Đơn hàng của tôi',
      'Tin nhắn',
      'Trở thành người bán',
      'Đăng xuất',
    ]);
  });

  it('chưa kịp biết shop (shopLink null) -> vẫn có "Đơn hàng của tôi" và Đăng xuất, đủ dải phân cách', async () => {
    sellerLink.mockReturnValue(null);
    const menu = await openAccountMenu();

    expect(screen.getByRole('menuitem', { name: 'Đơn hàng của tôi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
  });

  describe('mục "Quản trị" (Week8.md 3.9) — chỉ ADMIN', () => {
    it('ADMIN -> có "Quản trị" trỏ /admin/shops, đứng sau mục người bán và trước Đăng xuất', async () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      const menu = await openAccountMenu();

      expect(screen.getByRole('menuitem', { name: 'Quản trị' })).toHaveAttribute(
        'href',
        '/admin/shops',
      );
      const labels = Array.from(menu.querySelectorAll('[role="menuitem"], button')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual([
        'Trang cá nhân',
        'Đơn hàng của tôi',
        'Tin nhắn',
        'Sản phẩm của tôi',
        'Quản trị',
        'Hoàn tiền',
        'Đăng xuất',
      ]);
    });

    it('ADMIN -> có "Hoàn tiền" trỏ /admin/refunds, ngay sau "Quản trị" (Week9.md 3.7)', async () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      await openAccountMenu();

      const refunds = screen.getByRole('menuitem', { name: 'Hoàn tiền' });
      const admin = screen.getByRole('menuitem', { name: 'Quản trị' });
      expect(refunds).toHaveAttribute('href', '/admin/refunds');
      expect(
        admin.compareDocumentPosition(refunds) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('người dùng thường (USER) và khách -> KHÔNG có "Hoàn tiền" của Admin', async () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'USER' };
      await openAccountMenu();
      expect(screen.queryByRole('menuitem', { name: 'Hoàn tiền' })).not.toBeInTheDocument();
    });

    it('ADMIN nhưng chưa kịp biết shop (shopLink null) -> vẫn có "Quản trị"', async () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'ADMIN' };
      sellerLink.mockReturnValue(null);
      await openAccountMenu();

      expect(screen.getByRole('menuitem', { name: 'Quản trị' })).toBeInTheDocument();
    });

    it('người dùng thường (USER) -> KHÔNG có link tới /admin', async () => {
      auth.user = { name: 'Nguyễn Văn A', role: 'USER' };
      const menu = await openAccountMenu();

      expect(screen.queryByText('Quản trị')).not.toBeInTheDocument();
      expect(menu.querySelector('a[href^="/admin"]')).toBeNull();
    });

    it('khách chưa đăng nhập -> không có "Quản trị"', () => {
      auth.user = null;
      render(withIntl(<Header />));

      expect(screen.queryByText('Quản trị')).not.toBeInTheDocument();
    });
  });

  it('có mục "Trang cá nhân" trỏ /account, đứng ĐẦU menu (Week9.md 6.2)', async () => {
    const menu = await openAccountMenu();

    const account = screen.getByRole('menuitem', { name: 'Trang cá nhân' });
    expect(account).toHaveAttribute('href', '/account');
    expect(menu.querySelector('[role="menuitem"]')).toBe(account);
  });

  it('khách chưa đăng nhập -> KHÔNG có "Trang cá nhân"', () => {
    auth.user = null;
    render(withIntl(<Header />));

    expect(screen.queryByText('Trang cá nhân')).not.toBeInTheDocument();
  });

  it('khách chưa đăng nhập -> không có menu tài khoản, chỉ Đăng nhập/Đăng ký', () => {
    auth.user = null;
    render(withIntl(<Header />));

    expect(screen.queryByText('Đơn hàng của tôi')).not.toBeInTheDocument();
    // Button render={<Link/>} nativeButton=false -> role="button", href vẫn ở thẻ <a>.
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('button', { name: 'Đăng ký' })).toHaveAttribute('href', '/register');
  });

  it('cụm tài khoản chỉ ở >= sm (cặp với BottomTabBar sm:hidden — không có khoảng chết)', () => {
    render(withIntl(<Header />));

    const cluster = screen.getByRole('button', { name: /Nguyễn Văn A/ }).closest('.hidden');
    expect(cluster).toHaveClass('hidden', 'sm:flex');
  });
});

describe('Header — tin nhắn (Week10.md 5.5, D8)', () => {
  beforeEach(() => {
    auth.user = { name: 'Nguyễn Văn A' };
    auth.isHydrating = false;
    sellerLink.mockReturnValue(SHOP_LINK);
    pathname.mockReturnValue('/');
    Object.assign(chatBadges, { shopId: null, buyerUnread: 0, shopUnread: 0 });
  });

  const chatLinks = () => screen.getAllByRole('link', { name: /^Tin nhắn/ });

  it('đã đăng nhập: biểu tượng tin nhắn trỏ /chat, có bản mobile (hàng 1 bên phải logo) và bản desktop (cạnh giỏ hàng)', () => {
    render(withIntl(<Header />));

    const links = chatLinks();
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/chat');
    const [mobile, desktop] = links.map((link) => link.closest('div'));
    expect(mobile).toHaveClass('ml-auto', 'flex', 'sm:hidden');
    expect(desktop).toHaveClass('hidden', 'sm:flex');
  });

  it('khách chưa đăng nhập hoặc đang chờ xác định phiên: không có biểu tượng tin nhắn', () => {
    auth.user = null;
    const { rerender } = render(withIntl(<Header />));
    expect(screen.queryByRole('link', { name: /^Tin nhắn/ })).not.toBeInTheDocument();

    auth.isHydrating = true;
    rerender(withIntl(<Header />));
    expect(screen.queryByRole('link', { name: /^Tin nhắn/ })).not.toBeInTheDocument();
  });

  it('chưa đọc: huy hiệu số (aria-hidden) + bản chữ cho trình đọc màn hình; hết chưa đọc thì không huy hiệu', () => {
    chatBadges.buyerUnread = 3;
    const { rerender } = render(withIntl(<Header />));

    const [link] = chatLinks();
    expect(link).toHaveAccessibleName('Tin nhắn: 3 tin chưa đọc');
    expect(within(link).getByText('3')).toHaveAttribute('aria-hidden', 'true');

    chatBadges.buyerUnread = 0;
    rerender(withIntl(<Header />));
    expect(chatLinks()[0]).toHaveAccessibleName('Tin nhắn');
    expect(within(chatLinks()[0]).queryByText('3')).not.toBeInTheDocument();
  });

  it('quá 99 chưa đọc hiện "99+"', () => {
    chatBadges.buyerUnread = 250;
    render(withIntl(<Header />));

    expect(within(chatLinks()[0]).getByText('99+')).toBeInTheDocument();
  });

  it('đang ở /chat: biểu tượng đánh dấu aria-current="page"', () => {
    pathname.mockReturnValue('/chat');
    render(withIntl(<Header />));

    for (const link of chatLinks()) expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('menu tài khoản có "Tin nhắn" trỏ /chat kèm huy hiệu người mua; chưa có shop thì KHÔNG có "Tin nhắn của khách"', async () => {
    chatBadges.buyerUnread = 4;
    const menu = await openAccountMenu();

    const item = within(menu).getByRole('menuitem', { name: /^Tin nhắn/ });
    expect(item).toHaveAttribute('href', '/chat');
    expect(within(item).getByText('4')).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /Tin nhắn của khách/ }),
    ).not.toBeInTheDocument();
  });

  it('có shop: thêm "Tin nhắn của khách" trỏ /seller/chat kèm huy hiệu RIÊNG của shop, sau mục kênh người bán', async () => {
    Object.assign(chatBadges, { shopId: 'shop-1', buyerUnread: 1, shopUnread: 7 });
    const menu = await openAccountMenu();

    const seller = within(menu).getByRole('menuitem', { name: /Tin nhắn của khách/ });
    expect(seller).toHaveAttribute('href', '/seller/chat');
    expect(within(seller).getByText('7')).toBeInTheDocument();
    // Thứ tự các mục (văn bản có thêm số huy hiệu nên so theo tiền tố, không so bằng).
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const position = (prefix: string) =>
      items.findIndex((el) => el.textContent?.trim().startsWith(prefix));
    const order = [
      'Trang cá nhân',
      'Đơn hàng của tôi',
      'Tin nhắn',
      'Sản phẩm của tôi',
      'Tin nhắn của khách',
    ].map(position);
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('tin chưa đọc ở hộp thư SHOP nổi lên ngay trên avatar (người bán không phải mở menu mới biết có khách nhắn)', () => {
    Object.assign(chatBadges, { shopId: 'shop-1', shopUnread: 5 });
    render(withIntl(<Header />));

    const trigger = screen.getByRole('button', { name: /Nguyễn Văn A/ });
    expect(within(trigger).getByText('5')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAccessibleName(/5 tin chưa đọc/);
  });

  it('không có tin chưa đọc ở hộp thư shop: avatar không có huy hiệu', () => {
    Object.assign(chatBadges, { shopId: 'shop-1', shopUnread: 0 });
    render(withIntl(<Header />));

    const trigger = screen.getByRole('button', { name: /Nguyễn Văn A/ });
    expect(trigger.querySelector('.bg-primary.text-primary-foreground')).toBeNull();
  });
});
