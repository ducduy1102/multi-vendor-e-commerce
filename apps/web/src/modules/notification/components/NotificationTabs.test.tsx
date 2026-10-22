import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { NotificationTabs } from './NotificationTabs';

// Link giả: chuyển `href` dạng object { pathname, query } thành chuỗi để kiểm.
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: Omit<React.ComponentProps<'a'>, 'href'> & {
    href: string | { pathname: string; query?: Record<string, string> };
  }) => {
    const text =
      typeof href === 'string'
        ? href
        : `${href.pathname}${
            href.query && Object.keys(href.query).length > 0
              ? `?${new URLSearchParams(href.query).toString()}`
              : ''
          }`;
    return (
      <a href={text} {...props}>
        {children}
      </a>
    );
  },
}));

describe('NotificationTabs', () => {
  it('hai tab là LINK thật: "Tất cả" về /notifications (không tham số), "Chưa đọc" là ?tab=unread', () => {
    render(withIntl(<NotificationTabs activeTab="all" />));

    expect(screen.getByRole('link', { name: 'Tất cả' })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('link', { name: 'Chưa đọc' })).toHaveAttribute(
      'href',
      '/notifications?tab=unread',
    );
  });

  it('tab đang chọn có aria-current="page", tab còn lại thì không', () => {
    const { rerender } = render(withIntl(<NotificationTabs activeTab="all" />));
    expect(screen.getByRole('link', { name: 'Tất cả' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Chưa đọc' })).not.toHaveAttribute('aria-current');

    rerender(withIntl(<NotificationTabs activeTab="unread" />));
    expect(screen.getByRole('link', { name: 'Chưa đọc' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tất cả' })).not.toHaveAttribute('aria-current');
  });

  it('vùng điều hướng có nhãn trợ năng; bản tiếng Anh dịch đúng', () => {
    render(withIntl(<NotificationTabs activeTab="all" />, 'en'));

    expect(screen.getByRole('navigation', { name: 'Filter notifications' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unread' })).toBeInTheDocument();
  });
});
