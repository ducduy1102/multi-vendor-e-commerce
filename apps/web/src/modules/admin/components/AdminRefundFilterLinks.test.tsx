import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  ADMIN_DISPUTE_FILTERS,
  ADMIN_DISPUTE_FILTER_LABEL_KEYS,
  ADMIN_LEDGER_FILTERS,
  ADMIN_LEDGER_FILTER_LABEL_KEYS,
} from '../admin-refunds-href';
import { AdminRefundFilterLinks } from './AdminRefundFilterLinks';

function disputes(activeStatus: string) {
  return render(
    withIntl(
      <AdminRefundFilterLinks
        tab="disputes"
        options={ADMIN_DISPUTE_FILTERS}
        labelKeys={ADMIN_DISPUTE_FILTER_LABEL_KEYS}
        activeStatus={activeStatus}
        ariaLabelKey="refundsDisputeFilterLabel"
      />,
    ),
  );
}

function ledger(activeStatus: string) {
  return render(
    withIntl(
      <AdminRefundFilterLinks
        tab="failed"
        options={ADMIN_LEDGER_FILTERS}
        labelKeys={ADMIN_LEDGER_FILTER_LABEL_KEYS}
        activeStatus={activeStatus}
        ariaLabelKey="refundsLedgerFilterLabel"
      />,
    ),
  );
}

describe('AdminRefundFilterLinks — khiếu nại', () => {
  it('hai bộ lọc: "Chờ sàn xử lý" (mặc định, không status trên URL) và "Chờ shop (ghi đè)"', () => {
    disputes('ESCALATED');

    const links = within(
      screen.getByRole('navigation', { name: 'Lọc yêu cầu theo bên đang xử lý' }),
    ).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Chờ sàn xử lý', 'Chờ shop (ghi đè)']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/refunds',
      '/admin/refunds?status=PENDING_SELLER',
    ]);
  });

  it('bộ lọc đang chọn được đánh dấu aria-current và kiểu nổi bật', () => {
    disputes('PENDING_SELLER');

    const active = screen.getByRole('link', { name: 'Chờ shop (ghi đè)' });
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveClass('border-primary', 'bg-primary/10', 'text-primary');
    expect(screen.getByRole('link', { name: 'Chờ sàn xử lý' })).not.toHaveAttribute('aria-current');
  });
});

describe('AdminRefundFilterLinks — hoàn tiền lỗi', () => {
  it('4 bộ lọc theo thứ tự, link GIỮ tab; bộ lọc mặc định của tab (Cần xử lý) không có status trên URL', () => {
    ledger('NEEDS_ACTION');

    const links = within(
      screen.getByRole('navigation', { name: 'Lọc khoản hoàn theo trạng thái' }),
    ).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Cần xử lý',
      'Đang chờ cổng',
      'Bị lỗi',
      'Đã hoàn',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/refunds?tab=failed',
      '/admin/refunds?tab=failed&status=PENDING',
      '/admin/refunds?tab=failed&status=FAILED',
      '/admin/refunds?tab=failed&status=SUCCEEDED',
    ]);
  });

  it.each(ADMIN_LEDGER_FILTERS)('bộ lọc %s đang chọn -> đúng MỘT link aria-current', (status) => {
    ledger(status);

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
  });

  it('hàng nút tự xuống dòng ở màn hẹp (flex-wrap) thay vì tràn ngang', () => {
    ledger('NEEDS_ACTION');

    expect(screen.getByRole('list')).toHaveClass('flex-wrap');
  });
});
