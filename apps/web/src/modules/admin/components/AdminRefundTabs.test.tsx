import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefundTab } from '../admin-refunds-href';
import { AdminRefundTabs } from './AdminRefundTabs';

const nav = () => screen.getByRole('navigation', { name: 'Các màn hoàn tiền' });

describe('AdminRefundTabs', () => {
  it('ba tab theo thứ tự Khiếu nại / Hoàn tiền lỗi / Thanh toán cần hoàn, link tới đúng URL (tab mặc định không có ?tab=)', () => {
    render(withIntl(<AdminRefundTabs activeTab="disputes" />));

    const links = within(nav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Khiếu nại',
      'Hoàn tiền lỗi',
      'Thanh toán cần hoàn',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/refunds',
      '/admin/refunds?tab=failed',
      '/admin/refunds?tab=payments',
    ]);
  });

  it.each([
    ['disputes', 'Khiếu nại'],
    ['failed', 'Hoàn tiền lỗi'],
    ['payments', 'Thanh toán cần hoàn'],
  ] as const)(
    'tab %s đang xem -> chỉ "%s" là trang hiện tại (aria-current)',
    (activeTab, label) => {
      render(withIntl(<AdminRefundTabs activeTab={activeTab as AdminRefundTab} />));

      const current = within(nav())
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent)).toEqual([label]);
    },
  );

  it('tab đang xem có kiểu nổi bật (viền + màu primary), tab khác muted', () => {
    render(withIntl(<AdminRefundTabs activeTab="failed" />));

    expect(within(nav()).getByRole('link', { name: 'Hoàn tiền lỗi' })).toHaveClass(
      'border-primary',
      'text-primary',
    );
    expect(within(nav()).getByRole('link', { name: 'Khiếu nại' })).toHaveClass(
      'text-muted-foreground',
    );
  });

  it('hàng tab tự cuộn ngang trong khung của nó, không làm cả trang tràn ngang', () => {
    render(withIntl(<AdminRefundTabs activeTab="disputes" />));

    expect(nav()).toHaveClass('overflow-x-auto');
  });
});
