import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('AdminNav — ngưỡng sidebar và lớp mờ (Week11.md 4.5, dòng 3 và 5)', () => {
  beforeEach(() => {
    pathname.mockReset();
    overview.current = undefined;
  });

  it('sidebar dọc chỉ từ xl (1280px), không còn lg:; dưới đó là thanh tab ngang', () => {
    renderNav();

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('xl:sticky', 'xl:w-56', 'xl:flex-col', 'xl:overflow-visible', 'xl:p-0');
    expect(nav.className).not.toMatch(/(^|\s)lg:/);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).not.toMatch(/(^|\s)lg:/);
    }
  });

  it('thanh tab ngang dưới sm có lớp mờ ở mép phải và chừa 32px sau mục cuối', () => {
    renderNav();

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('pl-4', 'pr-8');
    expect(nav.className).toContain(
      'max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]',
    );
  });

  it('layout /admin đổi sang hai cột cùng ngưỡng xl với AdminNav (lệch ngưỡng ⇒ khoảng không có điều hướng hoặc sidebar đè nội dung)', () => {
    const layout = readFileSync(
      resolve(__dirname, '../../../app/[locale]/admin/layout.tsx'),
      'utf8',
    );

    expect(layout).toContain('xl:flex-row');
    expect(layout).toContain('xl:gap-8');
    expect(layout).not.toMatch(/(^|\s)lg:flex-row/);
  });
});

describe('AdminNav', () => {
  beforeEach(() => {
    pathname.mockReset();
    overview.current = undefined;
  });

  it('một landmark điều hướng có tên, đủ 5 mục trỏ đúng route (chỉ trang đã có), Người dùng ngay sau Shop', () => {
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
    expect(screen.getByRole('link', { name: 'Kháng nghị' })).toHaveAttribute(
      'href',
      '/admin/appeals',
    );
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/shops',
      '/admin/users',
      '/admin/refunds',
      '/admin/appeals',
    ]);
  });

  it.each([
    ['/admin', 'Tổng quan'],
    ['/admin/shops', /^Shop/],
    ['/admin/users', 'Người dùng'],
    ['/admin/refunds', /^Hoàn tiền/],
    ['/admin/appeals', 'Kháng nghị'],
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
