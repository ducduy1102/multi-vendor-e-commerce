import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LazyNotificationBell,
  LazyNotificationRealtimeSync,
  LazyNotificationUnreadBadge,
} from './lazy-notification';

const auth = { user: null as { id: string } | null };
// Đếm số lần MODULE của mảnh thông báo thật sự được nạp: với `React.lazy(() => import(...))` factory của `vi.mock` chỉ chạy
// khi có người yêu cầu import, nên khách vãng lai không được làm nó chạy lần nào (đúng điều ta muốn ở bundle thật).
const loaded = { sync: 0, bell: 0, badge: 0 };

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('./NotificationRealtimeSync', () => {
  loaded.sync += 1;
  return { NotificationRealtimeSync: () => <span data-testid="sync" /> };
});
vi.mock('./NotificationBell', () => {
  loaded.bell += 1;
  return {
    NotificationBell: ({ className }: { className?: string }) => (
      <span className={className} data-testid="bell">
        bell
      </span>
    ),
  };
});
vi.mock('./NotificationUnreadBadge', () => {
  loaded.badge += 1;
  return {
    NotificationUnreadBadge: ({ className }: { className?: string }) => (
      <span data-testid="badge" className={className} />
    ),
  };
});

function renderAll() {
  return render(
    <>
      <LazyNotificationRealtimeSync />
      <LazyNotificationBell className="hidden sm:flex" />
      <LazyNotificationUnreadBadge className="static ml-auto" />
    </>,
  );
}

describe('lazy-notification', () => {
  beforeEach(() => {
    auth.user = null;
  });

  it('khách vãng lai: không dựng gì VÀ không nạp module thông báo nào', async () => {
    const { container } = renderAll();
    // Chờ hết việc đang treo rồi mới khẳng định phủ định (một lần nạp động chạy sau vài microtask).
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container).toBeEmptyDOMElement();
    expect(loaded).toEqual({ sync: 0, bell: 0, badge: 0 });
  });

  // THỨ TỰ CÓ CHỦ Ý: `React.lazy` nhớ kết quả sau lần nạp đầu nên chỉ lần render đầu tiên mới thấy fallback. Ca này phải
  // chạy TRƯỚC ca "đã đăng nhập" bên dưới (ca đó nạp nốt hai mảnh còn lại).
  it('trong lúc chunk của chuông đang tải giữ chỗ đúng cỡ nút (size-8) để không đẩy lệch Header', async () => {
    auth.user = { id: 'u1' };
    const { container } = render(<LazyNotificationBell className="hidden sm:flex" />);

    // Đồng bộ ngay sau render: Suspense chưa resolve ⇒ đang hiện fallback.
    const placeholder = container.querySelector('div.hidden');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector('span.size-8')).not.toBeNull();
    expect(placeholder?.querySelector('span.size-8')).toHaveAttribute('aria-hidden', 'true');
    // Nạp xong thì fallback được thay bằng chuông thật.
    expect(await screen.findByTestId('bell')).toBeInTheDocument();
  });

  it('đã đăng nhập: nạp rồi dựng đúng ba mảnh, truyền nguyên props', async () => {
    auth.user = { id: 'u1' };
    renderAll();

    expect(await screen.findByTestId('sync')).toBeInTheDocument();
    expect(await screen.findByTestId('bell')).toHaveClass('hidden', 'sm:flex');
    expect(await screen.findByTestId('badge')).toHaveClass('static', 'ml-auto');
    expect(loaded).toEqual({ sync: 1, bell: 1, badge: 1 });
  });
});
