import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { ShopStatus } from '../types';
import { AdminShopTabs } from './AdminShopTabs';

function renderTabs(activeStatus: ShopStatus) {
  render(withIntl(<AdminShopTabs activeStatus={activeStatus} />));
  return within(screen.getByRole('navigation', { name: 'Lọc shop theo trạng thái' }));
}

describe('AdminShopTabs', () => {
  it('đủ 4 tab theo đúng thứ tự, mỗi tab trỏ đúng ?status= (hàng chờ duyệt là mặc định nên không cần param, luôn về trang 1)', () => {
    const nav = renderTabs('PENDING');

    const links = nav.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Chờ duyệt', '/admin/shops'],
      ['Đã duyệt', '/admin/shops?status=APPROVED'],
      ['Đã từ chối', '/admin/shops?status=REJECTED'],
      ['Đã khoá', '/admin/shops?status=SUSPENDED'],
    ]);
  });

  it.each<[ShopStatus, string]>([
    ['PENDING', 'Chờ duyệt'],
    ['APPROVED', 'Đã duyệt'],
    ['REJECTED', 'Đã từ chối'],
    ['SUSPENDED', 'Đã khoá'],
  ])('status=%s -> chỉ đúng tab "%s" là tab hiện tại', (status, label) => {
    const nav = renderTabs(status);

    const current = nav
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it('không có tab "Tất cả" (BE luôn lọc theo đúng 1 trạng thái)', () => {
    const nav = renderTabs('PENDING');

    expect(nav.queryByRole('link', { name: 'Tất cả' })).not.toBeInTheDocument();
  });

  it('hàng tab tự cuộn ngang trong khung riêng, không làm cả trang tràn ngang trên màn hẹp', () => {
    renderTabs('PENDING');

    expect(screen.getByRole('navigation', { name: 'Lọc shop theo trạng thái' })).toHaveClass(
      'overflow-x-auto',
    );
  });
});
