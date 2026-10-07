import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { SELLER_ORDER_TAB_KEYS } from '../order-status-display';
import { SELLER_ORDERS_PATH } from '../orders-href';
import { OrderTabs } from './OrderTabs';

function renderTabs(activeTab?: Parameters<typeof OrderTabs>[0]['activeTab']) {
  render(withIntl(<OrderTabs activeTab={activeTab} />));
  return within(screen.getByRole('navigation', { name: 'Lọc đơn hàng theo trạng thái' }));
}

describe('OrderTabs', () => {
  it('"Tất cả" đứng đầu rồi tới 6 tab theo đúng thứ tự, mỗi tab trỏ đúng ?tab= (về trang 1)', () => {
    const nav = renderTabs();

    const links = nav.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Tất cả', '/orders'],
      ['Chờ thanh toán', '/orders?tab=awaiting-payment'],
      ['Chờ xác nhận', '/orders?tab=pending'],
      ['Đang xử lý', '/orders?tab=processing'],
      ['Đang giao', '/orders?tab=shipping'],
      ['Hoàn tất', '/orders?tab=completed'],
      ['Đã hủy', '/orders?tab=cancelled'],
    ]);
  });

  it('không truyền activeTab -> "Tất cả" là tab hiện tại, các tab khác thì không', () => {
    const nav = renderTabs();

    expect(nav.getByRole('link', { name: 'Tất cả' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Chờ xác nhận' })).not.toHaveAttribute('aria-current');
  });

  it('có activeTab -> chỉ đúng tab đó là tab hiện tại', () => {
    const nav = renderTabs('shipping');

    const current = nav
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Đang giao']);
  });

  describe('bộ tab của Seller', () => {
    function renderSellerTabs(activeTab?: Parameters<typeof OrderTabs>[0]['activeTab']) {
      render(
        withIntl(
          <OrderTabs
            activeTab={activeTab}
            tabs={SELLER_ORDER_TAB_KEYS}
            basePath={SELLER_ORDERS_PATH}
          />,
        ),
      );
      return within(screen.getByRole('navigation', { name: 'Lọc đơn hàng theo trạng thái' }));
    }

    it('không có "Chờ thanh toán"; mỗi tab trỏ về /seller/orders (không rơi về /orders của người mua)', () => {
      const nav = renderSellerTabs();

      const links = nav.getAllByRole('link');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Tất cả', '/seller/orders'],
        ['Chờ xác nhận', '/seller/orders?tab=pending'],
        ['Đang xử lý', '/seller/orders?tab=processing'],
        ['Đang giao', '/seller/orders?tab=shipping'],
        ['Hoàn tất', '/seller/orders?tab=completed'],
        ['Đã hủy', '/seller/orders?tab=cancelled'],
      ]);
      expect(nav.queryByRole('link', { name: 'Chờ thanh toán' })).not.toBeInTheDocument();
    });

    it('chỉ đúng tab đang xem là tab hiện tại', () => {
      const nav = renderSellerTabs('processing');

      const current = nav
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent)).toEqual(['Đang xử lý']);
    });
  });
});
