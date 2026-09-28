import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { BottomTabBar } from './BottomTabBar';

const usePathname = vi.fn();
const useCartCount = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => usePathname() as string,
}));

vi.mock('@/modules/cart', async () => {
  const actual = await vi.importActual<typeof import('@/modules/cart/components/CartCountBadge')>(
    '@/modules/cart/components/CartCountBadge',
  );
  return {
    CartCountBadge: actual.CartCountBadge,
    useCartCount: () => useCartCount() as number | null,
  };
});

// AccountSheet kéo theo auth/shop/query — đã có kiểm riêng, ở đây chỉ cần
// biết nó vẫn nằm trong tab bar.
vi.mock('@/shared/components/AccountSheet', () => ({
  AccountSheet: () => <button type="button">Tài khoản</button>,
}));

function renderBar() {
  return render(withIntl(<BottomTabBar />));
}

describe('BottomTabBar', () => {
  beforeEach(() => {
    usePathname.mockReturnValue('/');
    useCartCount.mockReturnValue(null);
  });

  it('có đủ 4 tab: Trang chủ, Sản phẩm, Giỏ hàng, Tài khoản', () => {
    renderBar();

    const nav = screen.getByRole('navigation', { name: 'Điều hướng nhanh' });
    expect(within(nav).getByRole('link', { name: 'Trang chủ' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Sản phẩm' })).toHaveAttribute(
      'href',
      '/products',
    );
    expect(within(nav).getByRole('link', { name: /Giỏ hàng/ })).toHaveAttribute('href', '/cart');
    expect(within(nav).getByRole('button', { name: 'Tài khoản' })).toBeInTheDocument();
  });

  it('chỉ hiện ở mobile: cặp sm:hidden khớp breakpoint ẩn hiện điều hướng của Header', () => {
    renderBar();

    expect(screen.getByRole('navigation')).toHaveClass('sm:hidden');
  });

  it('giỏ trống/chưa biết -> không có badge, không có chữ số item cho trình đọc màn hình', () => {
    useCartCount.mockReturnValue(0);
    renderBar();

    const cartLink = screen.getByRole('link', { name: /Giỏ hàng/ });
    expect(cartLink).toHaveAccessibleName('Giỏ hàng');
    expect(within(cartLink).queryByText('0')).not.toBeInTheDocument();
  });

  it('có item -> hiện badge số và đọc được "N sản phẩm" cho trình đọc màn hình', () => {
    useCartCount.mockReturnValue(3);
    renderBar();

    const cartLink = screen.getByRole('link', { name: /Giỏ hàng/ });
    expect(within(cartLink).getByText('3')).toBeInTheDocument();
    expect(cartLink).toHaveAccessibleName('Giỏ hàng 3 sản phẩm');
  });

  it('nhiều hơn 99 item -> badge rút gọn 99+', () => {
    useCartCount.mockReturnValue(150);
    renderBar();

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it.each([
    ['/cart', 'Giỏ hàng'],
    ['/', 'Trang chủ'],
    ['/products', 'Sản phẩm'],
    ['/products/ao-thun', 'Sản phẩm'],
  ])('ở %s -> tab "%s" được đánh dấu trang hiện tại', (pathname, activeLabel) => {
    usePathname.mockReturnValue(pathname);
    renderBar();

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(activeLabel);
  });

  it('trang đăng nhập/đăng ký (ẩn chrome) -> không render tab bar', () => {
    usePathname.mockReturnValue('/login');
    const { container } = renderBar();

    expect(container).toBeEmptyDOMElement();
  });
});
