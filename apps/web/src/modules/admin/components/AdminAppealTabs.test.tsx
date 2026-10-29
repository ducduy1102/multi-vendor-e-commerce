import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminAppealListFilter } from '../types';
import { AdminAppealTabs } from './AdminAppealTabs';

afterEach(() => {
  cleanup();
});

function renderTabs(activeStatus: AdminAppealListFilter, locale: 'vi' | 'en' = 'vi') {
  return render(withIntl(<AdminAppealTabs activeStatus={activeStatus} />, locale));
}

describe('AdminAppealTabs', () => {
  it('một landmark điều hướng có tên, đủ bốn tab theo thứ tự, mỗi tab là LINK tới ?status= (tab mặc định không kèm param)', () => {
    renderTabs('PENDING');

    expect(
      screen.getByRole('navigation', { name: 'Lọc kháng nghị theo trạng thái' }),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Chờ xử lý',
      'Đã chấp nhận',
      'Đã từ chối',
      'Đã đóng',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/appeals',
      '/admin/appeals?status=ACCEPTED',
      '/admin/appeals?status=REJECTED',
      '/admin/appeals?status=CLOSED',
    ]);
  });

  it.each([
    ['PENDING', 'Chờ xử lý'],
    ['ACCEPTED', 'Đã chấp nhận'],
    ['REJECTED', 'Đã từ chối'],
    ['CLOSED', 'Đã đóng'],
  ] as const)('tab %s đang chọn: chỉ MỘT link có aria-current="page"', (status, name) => {
    renderTabs(status);

    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('link', { name }));
    expect(current[0]).toHaveAttribute('aria-current', 'page');
  });

  it('hàng tab cuộn ngang được trên màn hẹp (khung cuộn có mép mờ)', () => {
    const { container } = renderTabs('PENDING');

    const nav = container.querySelector('nav');
    expect(nav).toHaveClass('overflow-x-auto');
  });

  it('bản tiếng Anh không lẫn chuỗi tiếng Việt', () => {
    renderTabs('PENDING', 'en');

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Pending',
      'Accepted',
      'Rejected',
      'Closed',
    ]);
  });
});
