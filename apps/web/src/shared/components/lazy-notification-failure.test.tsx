import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LazyNotificationBell,
  LazyNotificationRealtimeSync,
  LazyNotificationUnreadBadge,
} from './lazy-notification';

// Chunk của mảnh thông báo tải LỖI (mạng chập chờn lúc vừa vào trang): factory của mock ném lỗi nên `import()` bị từ chối
// đúng như một ChunkLoadError thật. Khi đó chỉ mất chuông/huy hiệu thông báo, KHÔNG được làm sập phần còn lại của trang.
vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'u1' } }),
}));
vi.mock('./NotificationRealtimeSync', () => {
  throw new Error('ChunkLoadError: NotificationRealtimeSync');
});
vi.mock('./NotificationBell', () => {
  throw new Error('ChunkLoadError: NotificationBell');
});
vi.mock('./NotificationUnreadBadge', () => {
  throw new Error('ChunkLoadError: NotificationUnreadBadge');
});

describe('lazy-notification — chunk tải lỗi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cả ba mảnh lỗi ⇒ không dựng gì, KHÔNG ném lỗi ra ngoài, nội dung bên cạnh vẫn còn', async () => {
    // React tự in lỗi đã bắt bởi error boundary ra console.error; chặn để log test sạch.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <main>
        <p>nội dung trang</p>
        <LazyNotificationRealtimeSync />
        <LazyNotificationBell className="hidden sm:flex" />
        <LazyNotificationUnreadBadge />
      </main>,
    );
    // Lần nạp động bị từ chối và rào lỗi dựng xong bất đồng bộ (chuông hiện chỗ giữ cỡ nút trong lúc chờ).
    await waitFor(() =>
      expect(document.querySelector('main')?.innerHTML).toBe('<p>nội dung trang</p>'),
    );

    expect(screen.getByText('nội dung trang')).toBeInTheDocument();
  });
});
