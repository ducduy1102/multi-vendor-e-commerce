import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { NotificationUnreadBadge } from './NotificationUnreadBadge';

const auth = { user: null as { id: string } | null };
const unread = { data: undefined as number | undefined };

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/notification', () => ({
  useUnreadNotificationCount: () => unread,
}));

describe('NotificationUnreadBadge', () => {
  beforeEach(() => {
    auth.user = { id: 'u1' };
    unread.data = 0;
  });

  it('không chưa đọc (hoặc chưa tải xong): không dựng gì', () => {
    const { container, rerender } = render(withIntl(<NotificationUnreadBadge />));
    expect(container).toBeEmptyDOMElement();

    unread.data = undefined;
    rerender(withIntl(<NotificationUnreadBadge />));
    expect(container).toBeEmptyDOMElement();
  });

  it('có chưa đọc: huy hiệu tròn aria-hidden + bản chữ sr-only cho trình đọc màn hình', () => {
    unread.data = 5;
    render(withIntl(<NotificationUnreadBadge />));

    expect(screen.getByText('5')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('5 thông báo chưa đọc')).toHaveClass('sr-only');
  });

  it('className truyền xuống huy hiệu (menu dùng `static ml-auto`)', () => {
    unread.data = 2;
    render(withIntl(<NotificationUnreadBadge className="static ml-auto" />));

    expect(screen.getByText('2')).toHaveClass('static', 'ml-auto');
  });

  it('quá 99 hiện 99+; bản tiếng Anh dùng số ít', () => {
    unread.data = 150;
    const { rerender } = render(withIntl(<NotificationUnreadBadge />, 'en'));
    expect(screen.getByText('99+')).toBeInTheDocument();

    unread.data = 1;
    rerender(withIntl(<NotificationUnreadBadge />, 'en'));
    expect(screen.getByText('1 unread notification')).toBeInTheDocument();
  });
});
