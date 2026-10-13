import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  SELLER_REFUND_REQUEST_FILTERS,
  type SellerRefundRequestFilter,
} from '../refund-requests-href';
import { SellerRefundRequestTabs } from './SellerRefundRequestTabs';

const LABELS: Record<SellerRefundRequestFilter, string> = {
  PENDING_SELLER: 'Chờ bạn phản hồi',
  ESCALATED: 'Đã khiếu nại',
  APPROVED: 'Đã chấp thuận',
  REJECTED_BY_SELLER: 'Bạn đã từ chối',
  REJECTED: 'Sàn đã từ chối',
  all: 'Tất cả',
};

function renderTabs(activeFilter: SellerRefundRequestFilter) {
  render(withIntl(<SellerRefundRequestTabs activeFilter={activeFilter} />));
  return within(screen.getByRole('navigation', { name: 'Lọc yêu cầu theo trạng thái' }));
}

describe('SellerRefundRequestTabs', () => {
  it('đúng 6 tab theo thứ tự việc-cần-làm trước, mỗi tab trỏ đúng ?status= (tab mặc định không có tham số, về trang 1)', () => {
    const nav = renderTabs('PENDING_SELLER');

    expect(
      nav.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Chờ bạn phản hồi', '/seller/refund-requests'],
      ['Đã khiếu nại', '/seller/refund-requests?status=ESCALATED'],
      ['Đã chấp thuận', '/seller/refund-requests?status=APPROVED'],
      ['Bạn đã từ chối', '/seller/refund-requests?status=REJECTED_BY_SELLER'],
      ['Sàn đã từ chối', '/seller/refund-requests?status=REJECTED'],
      ['Tất cả', '/seller/refund-requests?status=all'],
    ]);
  });

  it('có một tab cho mỗi bộ lọc của trang (không bỏ sót, không thừa)', () => {
    const nav = renderTabs('PENDING_SELLER');

    expect(nav.getAllByRole('link')).toHaveLength(SELLER_REFUND_REQUEST_FILTERS.length);
  });

  it.each(SELLER_REFUND_REQUEST_FILTERS)(
    'bộ lọc %s -> chỉ đúng một tab là tab hiện tại (aria-current)',
    (filter) => {
      const nav = renderTabs(filter);

      const current = nav
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent)).toEqual([LABELS[filter]]);
    },
  );

  it('hàng tab cuộn ngang trong khung của nó trên màn hẹp (không làm cả trang tràn ngang)', () => {
    renderTabs('PENDING_SELLER');

    expect(screen.getByRole('navigation')).toHaveClass('overflow-x-auto');
  });
});
