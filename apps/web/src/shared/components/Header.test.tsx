import { render, screen } from '@testing-library/react';
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
  });

  it('đã đăng nhập -> menu có "Đơn hàng của tôi" trỏ /orders', async () => {
    await openAccountMenu();

    expect(screen.getByRole('menuitem', { name: 'Đơn hàng của tôi' })).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('thứ tự: Đơn hàng của tôi -> kênh người bán -> Đăng xuất', async () => {
    const menu = await openAccountMenu();

    const labels = Array.from(menu.querySelectorAll('[role="menuitem"], button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Đơn hàng của tôi', 'Sản phẩm của tôi', 'Đăng xuất']);
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
    expect(labels).toEqual(['Đơn hàng của tôi', 'Trở thành người bán', 'Đăng xuất']);
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
      expect(labels).toEqual(['Đơn hàng của tôi', 'Sản phẩm của tôi', 'Quản trị', 'Đăng xuất']);
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

  it('mục "Trang cá nhân" vẫn ẨN (chưa có trang tài khoản thật)', async () => {
    await openAccountMenu();

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
