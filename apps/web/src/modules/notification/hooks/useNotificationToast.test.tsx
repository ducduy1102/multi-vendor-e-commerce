import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import viMessages from '../../../../messages/vi.json';
import {
  ORDER_ID,
  at,
  makeNotification,
  makeUnknownNotification,
  uuid,
} from '../notification-test-data';
import * as notificationService from '../services/notification.service';
import type { Notification } from '../types';
import { useNotificationToast } from './useNotificationToast';

vi.mock('../services/notification.service');

const toastMock = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname() as string,
}));

const markReadMock = vi.mocked(notificationService.markRead);

const refundRejected: Notification = {
  id: uuid(5),
  readAt: null,
  createdAt: at(0),
  type: 'REFUND_REQUEST_REJECTED',
  data: { orderId: ORDER_ID, kind: 'CANCEL', reason: 'Đơn đã đóng gói' },
};

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('useNotificationToast', () => {
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="vi" messages={viMessages}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    toastMock.mockReset();
    push.mockReset();
    pathname.mockReset().mockReturnValue('/');
    markReadMock.mockReset().mockResolvedValue({ readAt: at(9) });
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    setVisibility('visible');
  });

  const toastFn = () => renderHook(() => useNotificationToast(), { wrapper }).result.current;

  it('loại quan trọng + tab đang hiển thị ⇒ hiện toast với tiêu đề và nội dung đã dịch', () => {
    toastFn()(makeNotification({ id: uuid(9) }));

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0] as [
      string,
      { description: string; id: string },
    ];
    expect(title).toBe('Đơn hàng mới');
    expect(options.description).toBe(`Bạn có đơn hàng mới #${ORDER_ID.slice(0, 8)}.`);
    // id = id thông báo: cùng một thông báo tới hai lần chỉ thay toast cũ, không nhân đôi.
    expect(options.id).toBe(uuid(9));
  });

  it('loại KHÔNG quan trọng (đơn được xác nhận) ⇒ không toast', () => {
    toastFn()({
      id: uuid(1),
      readAt: null,
      createdAt: at(0),
      type: 'ORDER_CONFIRMED',
      data: { orderId: ORDER_ID, shopName: 'Shop' },
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('loại lạ (UNKNOWN) ⇒ không toast', () => {
    toastFn()(makeUnknownNotification());

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('tab ĐANG ẨN ⇒ không toast (người dùng sẽ thấy huy hiệu khi quay lại)', () => {
    setVisibility('hidden');

    toastFn()(makeNotification());

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('đang ở chính trang /notifications ⇒ không toast (dòng mới đã hiện ở đầu danh sách)', () => {
    pathname.mockReturnValue('/notifications');

    toastFn()(makeNotification());

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('nút "Xem": đánh dấu đã đọc rồi điều hướng tới đúng đường dẫn', async () => {
    toastFn()(makeNotification({ id: uuid(9) }));
    const options = toastMock.mock.calls[0][1] as {
      action: { label: string; onClick: () => void };
    };

    expect(options.action.label).toBe('Xem');
    options.action.onClick();

    // `useMutation` chỉ gọi service sau vài microtask.
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(uuid(9)));
    expect(push).toHaveBeenCalledWith(`/seller/orders/${ORDER_ID}`);
  });

  it('lý do của người dùng hiện trong nội dung toast', () => {
    toastFn()(refundRejected);

    const options = toastMock.mock.calls[0][1] as { description: string };
    expect(options.description).toContain('Lý do: Đơn đã đóng gói');
  });

  it('không có đường dẫn đích (id hỏng) ⇒ vẫn toast nhưng KHÔNG có nút "Xem"', () => {
    toastFn()(makeNotification({ orderId: 'not-a-uuid' }));

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect((toastMock.mock.calls[0][1] as { action: unknown }).action).toBeUndefined();
  });
});
