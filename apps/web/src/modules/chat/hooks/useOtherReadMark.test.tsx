import { REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONVERSATION_ID, OTHER_CONVERSATION_ID, SHOP_ID, at } from '../chat-test-data';
import {
  createChatHarness,
  resetChatHarnessAuth,
  type ChatTestHarness,
} from '../chat-test-wrapper';
import { setOtherReadMark } from './chat-cache';
import type { ChatScope } from '../types';
import { useChatRealtimeSync } from './useChatRealtimeSync';
import { useOtherReadMark } from './useOtherReadMark';

const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };

describe('useOtherReadMark', () => {
  let h: ChatTestHarness;

  beforeEach(() => {
    h = createChatHarness();
  });

  afterEach(() => {
    cleanup();
    resetChatHarnessAuth();
    vi.restoreAllMocks();
  });

  it('chỉ có mốc từ bản tóm tắt (vừa tải lại trang) ⇒ dùng mốc đó', () => {
    const { result } = renderHook(() => useOtherReadMark(CONVERSATION_ID, at(5)), {
      wrapper: h.wrapper,
    });

    expect(result.current).toBe(at(5));
  });

  it('chưa biết gì (tóm tắt null/undefined, chưa có sự kiện) ⇒ null', () => {
    const fromNull = renderHook(() => useOtherReadMark(CONVERSATION_ID, null), {
      wrapper: h.wrapper,
    });
    const fromUndefined = renderHook(() => useOtherReadMark(CONVERSATION_ID, undefined), {
      wrapper: h.wrapper,
    });

    expect(fromNull.result.current).toBeNull();
    expect(fromUndefined.result.current).toBeNull();
  });

  it('chat:read tới sau ⇒ mốc nhích lên NGAY, không cần tải lại danh sách', async () => {
    const { result } = renderHook(
      () => {
        useChatRealtimeSync(SHOP);
        return useOtherReadMark(CONVERSATION_ID, at(5));
      },
      { wrapper: h.wrapper },
    );
    await h.connect();
    expect(result.current).toBe(at(5));

    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatRead, {
        conversationId: CONVERSATION_ID,
        readAt: at(9),
      }),
    );

    await waitFor(() => expect(result.current).toBe(at(9)));
  });

  it('mốc chỉ TĂNG: sự kiện cũ hơn mốc của tóm tắt không kéo lùi; tóm tắt cũ hơn sự kiện thì sự kiện thắng', async () => {
    setOtherReadMark(h.queryClient, CONVERSATION_ID, at(3));
    const { result, rerender } = renderHook(
      ({ summaryMark }) => useOtherReadMark(CONVERSATION_ID, summaryMark),
      { wrapper: h.wrapper, initialProps: { summaryMark: at(8) as string | null } },
    );
    await waitFor(() => expect(result.current).toBe(at(8)));

    rerender({ summaryMark: at(1) });
    await waitFor(() => expect(result.current).toBe(at(3)));

    rerender({ summaryMark: null });
    await waitFor(() => expect(result.current).toBe(at(3)));
  });

  it('chat:read của hội thoại KHÁC không lẫn vào', async () => {
    setOtherReadMark(h.queryClient, OTHER_CONVERSATION_ID, at(50));

    const { result } = renderHook(() => useOtherReadMark(CONVERSATION_ID, null), {
      wrapper: h.wrapper,
    });
    await h.settle();

    expect(result.current).toBeNull();
  });

  it('chưa chọn hội thoại (null) ⇒ null, dù có mốc ở khoá rỗng', async () => {
    setOtherReadMark(h.queryClient, '', at(50));

    const { result } = renderHook(() => useOtherReadMark(null, at(9)), { wrapper: h.wrapper });
    await h.settle();

    expect(result.current).toBeNull();
  });
});
