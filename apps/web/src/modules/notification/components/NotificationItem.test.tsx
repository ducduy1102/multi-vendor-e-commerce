import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  ORDER_ID,
  at,
  makeNotification,
  makeUnknownNotification,
  uuid,
} from '../notification-test-data';
import type { Notification } from '../types';
import { NotificationItem } from './NotificationItem';

// Link giả: giữ `href` thật để kiểm đường dẫn, và chặn điều hướng mặc định (jsdom không cài đặt điều hướng).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, onClick, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

const NOW = Date.parse('2030-01-02T12:00:00.000Z');

function setup(notification: Notification, options: { now?: number; locale?: 'vi' | 'en' } = {}) {
  const onOpen = vi.fn();
  const utils = render(
    withIntl(
      <ul>
        <NotificationItem notification={notification} now={options.now ?? NOW} onOpen={onOpen} />
      </ul>,
      options.locale,
    ),
  );
  return { ...utils, onOpen };
}

describe('NotificationItem', () => {
  describe('nội dung và đường dẫn', () => {
    it('có đường dẫn đích ⇒ LINK thật (chủ shop: /seller/orders/:id) kèm tiêu đề và nội dung đã dịch', () => {
      setup(makeNotification());

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', `/seller/orders/${ORDER_ID}`);
      expect(link).toHaveTextContent('Đơn hàng mới');
      expect(link).toHaveTextContent(`Bạn có đơn hàng mới #${ORDER_ID.slice(0, 8)}.`);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('cùng loại thông báo, KHÁC phía nhận ⇒ khác đường dẫn (hủy đơn: người mua /orders, chủ shop /seller/orders)', () => {
      const buyerSide: Notification = {
        id: uuid(1),
        readAt: null,
        createdAt: at(0),
        type: 'ORDER_CANCELLED',
        data: { orderId: ORDER_ID, audience: 'BUYER', by: 'SELLER', shopName: 'Shop Áo' },
      };
      const { unmount } = setup(buyerSide);
      expect(screen.getByRole('link')).toHaveAttribute('href', `/orders/${ORDER_ID}`);
      unmount();

      setup({
        ...buyerSide,
        data: { orderId: ORDER_ID, audience: 'SELLER', by: 'BUYER', shopName: 'Shop Áo' },
      });
      expect(screen.getByRole('link')).toHaveAttribute('href', `/seller/orders/${ORDER_ID}`);
    });

    it('không có đường dẫn (loại lạ) ⇒ BUTTON, không có link', () => {
      setup(makeUnknownNotification());

      expect(screen.getByRole('button')).toHaveTextContent('Thông báo mới');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('bản tiếng Anh: chữ tiếng Anh', () => {
      setup(makeNotification(), { locale: 'en' });

      expect(screen.getByRole('link')).toHaveTextContent('New order');
      expect(screen.getByRole('link')).toHaveTextContent(
        `You have a new order #${ORDER_ID.slice(0, 8)}.`,
      );
    });
  });

  describe('chưa đọc / đã đọc', () => {
    it('chưa đọc: nền nhẹ, tiêu đề đậm, chữ "Chưa đọc" cho trình đọc màn hình, có chấm', () => {
      const { container } = setup(makeNotification({ readAt: null }));

      const link = screen.getByRole('link');
      expect(link).toHaveClass('bg-primary/5');
      expect(screen.getByText('Đơn hàng mới')).toHaveClass('font-semibold');
      expect(screen.getByText('Chưa đọc.')).toHaveClass('sr-only');
      expect(container.querySelector('span.bg-primary[aria-hidden="true"]')).not.toBeNull();
    });

    it('đã đọc: không nền nổi, tiêu đề thường, không chữ "Chưa đọc", không chấm màu', () => {
      const { container } = setup(makeNotification({ readAt: at(5) }));

      expect(screen.getByRole('link')).not.toHaveClass('bg-primary/5');
      expect(screen.getByText('Đơn hàng mới')).toHaveClass('font-medium');
      expect(screen.queryByText('Chưa đọc.')).not.toBeInTheDocument();
      expect(container.querySelector('span.bg-primary[aria-hidden="true"]')).toBeNull();
    });
  });

  describe('bấm vào dòng', () => {
    it('link: gọi onOpen với đúng thông báo', async () => {
      const notification = makeNotification({ id: uuid(77) });
      const { onOpen } = setup(notification);

      await userEvent.click(screen.getByRole('link'));

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(notification);
    });

    it('button (không đường dẫn): gọi onOpen với đúng thông báo', async () => {
      const notification = makeUnknownNotification({ id: uuid(78) });
      const { onOpen } = setup(notification);

      await userEvent.click(screen.getByRole('button'));

      expect(onOpen).toHaveBeenCalledWith(notification);
    });
  });

  describe('thời gian', () => {
    const created = (secondsAgo: number) => ({
      now: NOW,
      notification: makeNotification({
        createdAt: new Date(NOW - secondsAgo * 1000).toISOString(),
      }),
    });

    it('dưới một phút ⇒ "Vừa xong" (không "30 giây trước": "bây giờ" của trang chỉ nhích mỗi phút)', () => {
      const { notification, now } = created(30);
      setup(notification, { now });

      expect(screen.getByText('Vừa xong')).toBeInTheDocument();
    });

    it('vài phút ⇒ nhãn tương đối theo ngôn ngữ (vi / en)', () => {
      const { notification, now } = created(5 * 60);
      const { unmount } = setup(notification, { now });
      expect(screen.getByText(/5 phút trước/)).toBeInTheDocument();
      unmount();

      setup(notification, { now, locale: 'en' });
      expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
    });

    it('thẻ <time> mang mốc ISO gốc và `title` là ngày giờ đầy đủ', () => {
      const { notification, now } = created(2 * 3600);
      setup(notification, { now });

      const time = document.querySelector('time');
      expect(time).toHaveAttribute('dateTime', notification.createdAt);
      expect(time?.getAttribute('title')).toBeTruthy();
      expect(time?.getAttribute('title')).not.toBe(time?.textContent);
    });
  });

  describe('chữ do người dùng nhập', () => {
    const hostile = '<img src=x onerror=alert(1)> {code} {kind, select, CANCEL {a} other {b}}';
    const confirmed = (shopName: string): Notification => ({
      id: uuid(1),
      readAt: null,
      createdAt: at(0),
      type: 'ORDER_CONFIRMED',
      data: { orderId: ORDER_ID, shopName },
    });

    it('hiển thị NGUYÊN VĂN như text: không dựng phần tử HTML, không bị phân tích lại', () => {
      const { container } = setup(confirmed(hostile));

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('link')).toHaveTextContent(hostile);
    });

    it('chuỗi dài không dấu cách: xuống dòng được, cắt 3 dòng, `title` mang bản đầy đủ, cột giữa minmax(0,1fr)', () => {
      const long = 'x'.repeat(500);
      setup(confirmed(long));

      const body = screen.getByTitle(new RegExp(`^${long}`));
      expect(body).toHaveClass('line-clamp-3', '[overflow-wrap:anywhere]');
      expect(body.getAttribute('title')).toContain(long);
      expect(screen.getByRole('link').className).toContain('minmax(0,1fr)');
    });
  });
});
