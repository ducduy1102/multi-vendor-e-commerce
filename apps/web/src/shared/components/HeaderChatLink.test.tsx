import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { HeaderChatLink } from './HeaderChatLink';

const auth = { user: null as { id: string } | null };
const badges = { shopId: null as string | null, buyerUnread: 0, shopUnread: 0 };
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
vi.mock('@/shared/hooks/useChatBadges', () => ({ useChatBadges: () => badges }));

describe('HeaderChatLink', () => {
  beforeEach(() => {
    auth.user = { id: 'u1' };
    Object.assign(badges, { shopId: null, buyerUnread: 0, shopUnread: 0 });
    pathname.mockReturnValue('/');
  });

  it('khách (hoặc đang chờ xác định phiên): không dựng gì', () => {
    auth.user = null;
    const { container } = render(withIntl(<HeaderChatLink />));

    expect(container).toBeEmptyDOMElement();
  });

  it('đã đăng nhập: LINK THẬT (vai trò link, không phải button) tới /chat, tên truy cập "Tin nhắn"', () => {
    render(withIntl(<HeaderChatLink />));

    const link = screen.getByRole('link', { name: 'Tin nhắn' });
    expect(link).toHaveAttribute('href', '/chat');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('className do nơi đặt truyền vào nằm trên khối bọc (quyết định hiện/ẩn theo breakpoint)', () => {
    const { container } = render(withIntl(<HeaderChatLink className="ml-auto flex sm:hidden" />));

    expect(container.firstElementChild).toHaveClass('ml-auto', 'flex', 'sm:hidden');
  });

  it('chỉ tính hộp thư NGƯỜI MUA: huy hiệu shop không lọt vào icon', () => {
    Object.assign(badges, { shopId: 'shop-1', buyerUnread: 2, shopUnread: 9 });
    render(withIntl(<HeaderChatLink />));

    const link = screen.getByRole('link');
    expect(within(link).getByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(within(link).queryByText('9')).not.toBeInTheDocument();
    expect(link).toHaveAccessibleName('Tin nhắn: 2 tin chưa đọc');
  });

  it('không chưa đọc: không huy hiệu, tên truy cập không kèm số; quá 99 hiện 99+', () => {
    const { rerender } = render(withIntl(<HeaderChatLink />));
    expect(screen.getByRole('link')).toHaveAccessibleName('Tin nhắn');

    badges.buyerUnread = 500;
    rerender(withIntl(<HeaderChatLink />));
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('bản tiếng Anh: nhãn và số ít/số nhiều đúng', () => {
    badges.buyerUnread = 1;
    const { rerender } = render(withIntl(<HeaderChatLink />, 'en'));
    expect(screen.getByRole('link')).toHaveAccessibleName('Messages: 1 unread message');

    badges.buyerUnread = 3;
    rerender(withIntl(<HeaderChatLink />, 'en'));
    expect(screen.getByRole('link')).toHaveAccessibleName('Messages: 3 unread messages');
  });

  it('đang ở /chat hoặc /chat/...: aria-current="page"; trang khác thì không', () => {
    pathname.mockReturnValue('/chat');
    const { rerender } = render(withIntl(<HeaderChatLink />));
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');

    pathname.mockReturnValue('/chatter');
    rerender(withIntl(<HeaderChatLink />));
    expect(screen.getByRole('link')).not.toHaveAttribute('aria-current');
  });
});
