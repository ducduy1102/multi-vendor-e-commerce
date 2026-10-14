import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AccountNav } from './AccountNav';

const { pathname } = vi.hoisted(() => ({ pathname: vi.fn() }));

// Chỉ thay usePathname — giữ Link thật của next-intl.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  usePathname: () => pathname(),
}));

function renderNav(path: string) {
  pathname.mockReturnValue(path);
  render(withIntl(<AccountNav />));
}

describe('AccountNav', () => {
  beforeEach(() => {
    pathname.mockReset();
  });

  it('có đủ 3 mục trỏ đúng route, trong landmark điều hướng có tên', () => {
    renderNav('/account');

    expect(screen.getByRole('navigation', { name: 'Điều hướng tài khoản' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('link', { name: 'Sổ địa chỉ' })).toHaveAttribute(
      'href',
      '/account/addresses',
    );
    expect(screen.getByRole('link', { name: 'Mật khẩu' })).toHaveAttribute(
      'href',
      '/account/password',
    );
  });

  it.each([
    ['/account', 'Hồ sơ'],
    ['/account/addresses', 'Sổ địa chỉ'],
    ['/account/password', 'Mật khẩu'],
  ])('ở %s -> chỉ mục "%s" được đánh dấu aria-current="page"', (path, activeLabel) => {
    renderNav(path);

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([activeLabel]);
  });

  it('"/account" là tiền tố của mọi mục còn lại nhưng "Hồ sơ" KHÔNG sáng khi ở trang con', () => {
    renderNav('/account/addresses');

    expect(screen.getByRole('link', { name: 'Hồ sơ' })).not.toHaveAttribute('aria-current');
  });
});
