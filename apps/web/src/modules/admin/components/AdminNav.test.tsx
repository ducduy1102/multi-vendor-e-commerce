import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminOverview } from '../types';
import { AdminNav } from './AdminNav';

const { pathname, overview } = vi.hoisted(() => ({
  pathname: vi.fn(),
  overview: { current: undefined as AdminOverview | undefined },
}));

// Chỉ thay usePathname — giữ Link thật của next-intl.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  usePathname: () => pathname(),
}));
vi.mock('../hooks/useAdminOverview', () => ({
  useAdminOverview: () => ({ data: overview.current }),
}));

function renderNav(path = '/admin') {
  pathname.mockReturnValue(path);
  render(withIntl(<AdminNav />));
}

describe('AdminNav', () => {
  beforeEach(() => {
    pathname.mockReset();
    overview.current = undefined;
  });

  it('một landmark điều hướng có tên, đủ 4 mục trỏ đúng route (chỉ trang đã có), Người dùng ngay sau Shop', () => {
    renderNav();

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Khu quản trị' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: /^Shop/ })).toHaveAttribute('href', '/admin/shops');
    expect(screen.getByRole('link', { name: 'Người dùng' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(screen.getByRole('link', { name: /^Hoàn tiền/ })).toHaveAttribute(
      'href',
      '/admin/refunds',
    );
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/shops',
      '/admin/users',
      '/admin/refunds',
    ]);
  });

  it.each([
    ['/admin', 'Tổng quan'],
    ['/admin/shops', /^Shop/],
    ['/admin/users', 'Người dùng'],
    ['/admin/refunds', /^Hoàn tiền/],
  ] as const)('ở %s chỉ MỘT mục có aria-current="page"', (path, name) => {
    renderNav(path);

    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('link', { name }));
    expect(current[0]).toHaveAttribute('aria-current', 'page');
  });

  it('"Tổng quan" không sáng ở trang con (so khớp tuyệt đối)', () => {
    renderNav('/admin/shops');

    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current');
  });

  it('chưa có số (đang tải / lỗi) -> không hiện huy hiệu nào, thay vì số 0 sai', () => {
    overview.current = undefined;
    renderNav();

    expect(screen.getByRole('link', { name: 'Shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hoàn tiền' })).toBeInTheDocument();
    expect(screen.queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('có số -> Shop = shop chờ duyệt, Hoàn tiền = cộng ba hàng chờ, Tổng quan không có số', () => {
    overview.current = {
      pendingShops: 5,
      escalatedRefundRequests: 2,
      refundsNeedingAction: 3,
      refundablePayments: 4,
    };
    renderNav();

    expect(screen.getByRole('link', { name: 'Shop 5' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hoàn tiền 9' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toBeInTheDocument();
  });

  it('số 0 -> không hiện huy hiệu; số lớn -> "99+"', () => {
    overview.current = {
      pendingShops: 128,
      escalatedRefundRequests: 0,
      refundsNeedingAction: 0,
      refundablePayments: 0,
    };
    renderNav();

    expect(screen.getByRole('link', { name: 'Shop 99+' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hoàn tiền' })).toBeInTheDocument();
  });
});
