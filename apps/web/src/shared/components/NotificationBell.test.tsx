import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { NotificationBell } from './NotificationBell';

const auth = { user: null as { id: string } | null };
const unread = { data: undefined as number | undefined };
const enabledArg = vi.fn();
const pathname = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => pathname() as string,
}));
vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/notification', () => ({
  useUnreadNotificationCount: (options: { enabled: boolean }) => {
    enabledArg(options.enabled);
    return unread;
  },
}));

describe('NotificationBell', () => {
  beforeEach(() => {
    auth.user = { id: 'u1' };
    unread.data = 0;
    enabledArg.mockReset();
    pathname.mockReturnValue('/');
  });

  it('khách (hoặc đang chờ xác định phiên): không dựng gì và KHÔNG bật truy vấn huy hiệu', () => {
    auth.user = null;
    const { container } = render(withIntl(<NotificationBell />));

    expect(container).toBeEmptyDOMElement();
    expect(enabledArg).toHaveBeenCalledWith(false);
    expect(enabledArg).not.toHaveBeenCalledWith(true);
  });

  it('đã đăng nhập: LINK THẬT (vai trò link, không phải button) tới /notifications, tên truy cập "Thông báo"', () => {
    render(withIntl(<NotificationBell />));

    const link = screen.getByRole('link', { name: 'Thông báo' });
    expect(link).toHaveAttribute('href', '/notifications');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(enabledArg).toHaveBeenCalledWith(true);
  });

  it('className do nơi đặt truyền vào nằm trên khối bọc (quyết định hiện/ẩn theo breakpoint)', () => {
    const { container } = render(withIntl(<NotificationBell className="flex sm:hidden" />));

    expect(container.firstElementChild).toHaveClass('flex', 'sm:hidden');
  });

  it('có chưa đọc: huy hiệu aria-hidden + tên truy cập kèm số', () => {
    unread.data = 3;
    render(withIntl(<NotificationBell />));

    const link = screen.getByRole('link');
    expect(within(link).getByText('3')).toHaveAttribute('aria-hidden', 'true');
    expect(link).toHaveAccessibleName('Thông báo: 3 thông báo chưa đọc');
  });

  it('không chưa đọc: không huy hiệu, tên truy cập không kèm số; chưa tải xong (undefined) cũng vậy', () => {
    const { rerender } = render(withIntl(<NotificationBell />));
    expect(screen.getByRole('link')).toHaveAccessibleName('Thông báo');

    unread.data = undefined;
    rerender(withIntl(<NotificationBell />));
    expect(screen.getByRole('link')).toHaveAccessibleName('Thông báo');
  });

  it('quá 99 hiện 99+', () => {
    unread.data = 500;
    render(withIntl(<NotificationBell />));

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('bản tiếng Anh: nhãn và số ít/số nhiều đúng', () => {
    unread.data = 1;
    const { rerender } = render(withIntl(<NotificationBell />, 'en'));
    expect(screen.getByRole('link')).toHaveAccessibleName('Notifications: 1 unread notification');

    unread.data = 4;
    rerender(withIntl(<NotificationBell />, 'en'));
    expect(screen.getByRole('link')).toHaveAccessibleName('Notifications: 4 unread notifications');
  });

  it('đang ở /notifications: aria-current="page"; trang khác thì không', () => {
    pathname.mockReturnValue('/notifications');
    const { rerender } = render(withIntl(<NotificationBell />));
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');

    pathname.mockReturnValue('/orders');
    rerender(withIntl(<NotificationBell />));
    expect(screen.getByRole('link')).not.toHaveAttribute('aria-current');
  });
});
