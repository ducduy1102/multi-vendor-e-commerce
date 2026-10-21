import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { CONVERSATION_ID, OTHER_CONVERSATION_ID, SHOP_ID, at } from '../chat-test-data';
import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { useMarkReadWhileOpen } from './useMarkReadWhileOpen';

vi.mock('../services/chat.service');

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };
const markReadMock = vi.mocked(chatService.markRead);

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useMarkReadWhileOpen', () => {
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    markReadMock.mockReset();
    markReadMock.mockResolvedValue({ readAt: at(1) });
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    setVisibility('visible');
  });

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it('có tin chưa đọc và tab đang hiển thị ⇒ đánh dấu đã đọc đúng hội thoại và phạm vi', async () => {
    renderHook(() => useMarkReadWhileOpen(SHOP, CONVERSATION_ID, 2), { wrapper });

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));
    expect(markReadMock).toHaveBeenCalledWith(SHOP, CONVERSATION_ID);
  });

  it('không có tin chưa đọc ⇒ không gọi API', async () => {
    renderHook(() => useMarkReadWhileOpen(BUYER, CONVERSATION_ID, 0), { wrapper });
    await settle();

    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('chưa chọn hội thoại (null) ⇒ không gọi API', async () => {
    renderHook(() => useMarkReadWhileOpen(BUYER, null, 5), { wrapper });
    await settle();

    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('tab đang ẨN ⇒ chưa đánh dấu (người dùng chưa thấy tin); hiện lại thì đánh dấu', async () => {
    setVisibility('hidden');
    renderHook(() => useMarkReadWhileOpen(BUYER, CONVERSATION_ID, 3), { wrapper });
    await settle();
    expect(markReadMock).not.toHaveBeenCalled();

    act(() => setVisibility('visible'));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));
  });

  it('tin mới tới lúc đang mở (số chưa đọc tăng lại) ⇒ đánh dấu tiếp', async () => {
    const { rerender } = renderHook(
      ({ unread }) => useMarkReadWhileOpen(BUYER, CONVERSATION_ID, unread),
      { wrapper, initialProps: { unread: 2 } },
    );
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));

    rerender({ unread: 0 }); // lạc quan: đã về 0
    rerender({ unread: 1 }); // tin mới

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(2));
  });

  it('đổi hội thoại ⇒ đánh dấu hội thoại mới', async () => {
    const { rerender } = renderHook(({ id }) => useMarkReadWhileOpen(BUYER, id, 1), {
      wrapper,
      initialProps: { id: CONVERSATION_ID },
    });
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));

    rerender({ id: OTHER_CONVERSATION_ID });

    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(2));
    expect(markReadMock).toHaveBeenLastCalledWith(BUYER, OTHER_CONVERSATION_ID);
  });

  it('render lại với cùng số chưa đọc KHÔNG gọi lại', async () => {
    const { rerender } = renderHook(() => useMarkReadWhileOpen(BUYER, CONVERSATION_ID, 2), {
      wrapper,
    });
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    await settle();

    expect(markReadMock).toHaveBeenCalledTimes(1);
  });

  it('đánh dấu LỖI không thành vòng lặp: cùng (hội thoại, số chưa đọc) không thử lại; số đổi thì thử lại', async () => {
    markReadMock.mockRejectedValue(new ApiError('Cấm', 403));
    const { rerender } = renderHook(
      ({ unread }) => useMarkReadWhileOpen(BUYER, CONVERSATION_ID, unread),
      { wrapper, initialProps: { unread: 2 } },
    );
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));
    await settle();

    // Lỗi làm danh sách tải lại, số chưa đọc nhảy 0 → 2 như cũ: KHÔNG được gọi lại.
    rerender({ unread: 0 });
    rerender({ unread: 2 });
    await settle();
    expect(markReadMock).toHaveBeenCalledTimes(1);

    // Có tin mới thật (3) thì thử lại được.
    rerender({ unread: 3 });
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(2));
  });
});
