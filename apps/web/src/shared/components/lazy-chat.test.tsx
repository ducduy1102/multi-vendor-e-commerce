import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LazyChatRealtimeSync, LazyChatUnreadBadge, LazyHeaderChatLink } from './lazy-chat';

const auth = { user: null as { id: string } | null };
// Đếm số lần MODULE của mảnh chat thật sự được nạp: với `React.lazy(() => import(...))` factory của `vi.mock` chỉ chạy khi
// có người yêu cầu import, nên khách vãng lai không được làm nó chạy lần nào (đúng điều ta muốn ở bundle thật).
const loaded = { sync: 0, link: 0, badge: 0 };

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('./ChatRealtimeSync', () => {
  loaded.sync += 1;
  return { ChatRealtimeSync: () => <span data-testid="sync" /> };
});
vi.mock('./HeaderChatLink', () => {
  loaded.link += 1;
  return {
    HeaderChatLink: ({ className }: { className?: string }) => (
      <span className={className} data-testid="chat-link">
        chat
      </span>
    ),
  };
});
vi.mock('./ChatUnreadBadge', () => {
  loaded.badge += 1;
  return {
    ChatUnreadBadge: ({ scope, className }: { scope: string; className?: string }) => (
      <span data-testid="badge" data-scope={scope} className={className} />
    ),
  };
});

function renderAll() {
  return render(
    <>
      <LazyChatRealtimeSync />
      <LazyHeaderChatLink className="hidden sm:flex" />
      <LazyChatUnreadBadge scope="shop" className="static ml-auto" />
    </>,
  );
}

describe('lazy-chat', () => {
  beforeEach(() => {
    auth.user = null;
  });

  it('khách vãng lai: không dựng gì VÀ không nạp module chat nào', async () => {
    const { container } = renderAll();
    // Chờ hết việc đang treo rồi mới khẳng định phủ định (một lần nạp động chạy sau vài microtask).
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container).toBeEmptyDOMElement();
    expect(loaded).toEqual({ sync: 0, link: 0, badge: 0 });
  });

  // THỨ TỰ CÓ CHỦ Ý: `React.lazy` nhớ kết quả sau lần nạp đầu nên chỉ lần render đầu tiên mới thấy fallback. Ca này phải
  // chạy TRƯỚC ca "đã đăng nhập" bên dưới (ca đó nạp nốt hai mảnh còn lại).
  it('trong lúc chunk của biểu tượng tin nhắn đang tải giữ chỗ đúng cỡ nút (size-8) để không đẩy lệch Header', async () => {
    auth.user = { id: 'u1' };
    const { container } = render(<LazyHeaderChatLink className="hidden sm:flex" />);

    // Đồng bộ ngay sau render: Suspense chưa resolve ⇒ đang hiện fallback.
    const placeholder = container.querySelector('div.hidden');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector('span.size-8')).not.toBeNull();
    expect(placeholder?.querySelector('span.size-8')).toHaveAttribute('aria-hidden', 'true');
    // Nạp xong thì fallback được thay bằng biểu tượng thật.
    expect(await screen.findByTestId('chat-link')).toBeInTheDocument();
  });

  it('đã đăng nhập: nạp rồi dựng đúng ba mảnh, truyền nguyên props', async () => {
    auth.user = { id: 'u1' };
    renderAll();

    expect(await screen.findByTestId('sync')).toBeInTheDocument();
    const link = await screen.findByTestId('chat-link');
    expect(link).toHaveClass('hidden', 'sm:flex');
    const badge = await screen.findByTestId('badge');
    expect(badge).toHaveAttribute('data-scope', 'shop');
    expect(badge).toHaveClass('static', 'ml-auto');
    expect(loaded).toEqual({ sync: 1, link: 1, badge: 1 });
  });
});
