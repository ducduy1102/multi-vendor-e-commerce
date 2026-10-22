import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationRealtimeSync } from './NotificationRealtimeSync';

const auth = { user: null as { id: string } | null };
const syncOptions = vi.fn();
const toastNew = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/notification', () => ({
  useNotificationRealtimeSync: (options: unknown) => syncOptions(options),
  useNotificationToast: () => toastNew,
}));

describe('NotificationRealtimeSync', () => {
  beforeEach(() => {
    auth.user = null;
    syncOptions.mockReset();
    toastNew.mockReset();
  });

  it('không dựng gì ra giao diện', () => {
    auth.user = { id: 'u1' };
    const { container } = render(<NotificationRealtimeSync />);

    expect(container).toBeEmptyDOMElement();
  });

  it('đã đăng nhập: bật đồng bộ và nối toast vào onNew', () => {
    auth.user = { id: 'u1' };
    render(<NotificationRealtimeSync />);

    expect(syncOptions).toHaveBeenCalledWith({ enabled: true, onNew: toastNew });
  });

  it('chưa đăng nhập: đồng bộ bị tắt', () => {
    render(<NotificationRealtimeSync />);

    expect(syncOptions).toHaveBeenCalledWith({ enabled: false, onNew: toastNew });
  });
});
