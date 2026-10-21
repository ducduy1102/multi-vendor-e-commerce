import { REALTIME_EVENTS } from '@ecommerce/types';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  SHOP_ID,
  at,
  makeMessage,
} from '../chat-test-data';
import {
  createChatHarness,
  resetChatHarnessAuth,
  type ChatTestHarness,
} from '../chat-test-wrapper';
import {
  TYPING_EXPIRE_MS,
  TYPING_SEND_INTERVAL_MS,
  useSendTyping,
  useTypingIndicator,
} from './useTypingIndicator';

const typing = (conversationId = CONVERSATION_ID) => ({ conversationId });
const messageFrom = (senderRole: 'BUYER' | 'SHOP', conversationId = CONVERSATION_ID) => ({
  message: makeMessage({ senderRole, conversationId, createdAt: at(5) }),
  viewerRole: 'BUYER' as const,
  shopId: SHOP_ID,
});

describe('useTypingIndicator', () => {
  let h: ChatTestHarness;

  beforeEach(async () => {
    h = createChatHarness();
  });

  afterEach(() => {
    cleanup();
    resetChatHarnessAuth();
    vi.useRealTimers();
  });

  // Hẹn giờ giả chỉ bật SAU khi socket đã dựng (tạo socket dùng microtask/promise thật).
  const mount = async (initialId: string | null = CONVERSATION_ID) => {
    const hook = renderHook(({ id }) => useTypingIndicator(id), {
      wrapper: h.wrapper,
      initialProps: { id: initialId },
    });
    await h.connect();
    vi.useFakeTimers();
    return hook;
  };

  it('ban đầu không gõ', async () => {
    const { result } = await mount();

    expect(result.current).toBe(false);
  });

  it('nhận chat:typing của hội thoại này ⇒ đang gõ, và TỰ TẮT sau ~4 giây không có tín hiệu mới', async () => {
    const { result } = await mount();

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(TYPING_EXPIRE_MS - 1);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('tín hiệu mới gia hạn đồng hồ: không tắt sớm theo lần đầu', async () => {
    const { result } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    act(() => {
      vi.advanceTimersByTime(3000); // 6s kể từ lần đầu nhưng mới 3s kể từ lần hai
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it('typing của hội thoại KHÁC bị bỏ qua', async () => {
    const { result } = await mount();

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing(OTHER_CONVERSATION_ID)));

    expect(result.current).toBe(false);
  });

  it('chưa chọn hội thoại (null) ⇒ không bao giờ gõ', async () => {
    const { result } = await mount(null);

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));

    expect(result.current).toBe(false);
  });

  it('payload sai schema bị bỏ qua', async () => {
    const { result } = await mount();

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, { conversationId: 'abc' }));

    expect(result.current).toBe(false);
  });

  it('tin của ĐỐI PHƯƠNG tới ⇒ tắt NGAY (họ gõ xong và đã gửi)', async () => {
    const { result } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    expect(result.current).toBe(true);

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageFrom('SHOP')));

    expect(result.current).toBe(false);
  });

  it('tin của CHÍNH MÌNH (tab khác) không tắt tín hiệu của đối phương', async () => {
    const { result } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageFrom('BUYER')));

    expect(result.current).toBe(true);
  });

  it('tin của đối phương ở hội thoại KHÁC không tắt', async () => {
    const { result } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));

    act(() =>
      h.socket.serverEmits(REALTIME_EVENTS.chatMessage, messageFrom('SHOP', OTHER_CONVERSATION_ID)),
    );

    expect(result.current).toBe(true);
  });

  it('đổi hội thoại ⇒ tắt ngay; tín hiệu của hội thoại cũ tới sau đó bị bỏ qua', async () => {
    const { result, rerender } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    expect(result.current).toBe(true);

    rerender({ id: OTHER_CONVERSATION_ID });
    expect(result.current).toBe(false);

    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    expect(result.current).toBe(false);
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing(OTHER_CONVERSATION_ID)));
    expect(result.current).toBe(true);
  });

  it('gỡ component ⇒ dọn hẹn giờ (không còn timer treo)', async () => {
    const { unmount } = await mount();
    act(() => h.socket.serverEmits(REALTIME_EVENTS.chatTyping, typing()));
    const before = vi.getTimerCount();

    unmount();

    expect(vi.getTimerCount()).toBeLessThan(before);
  });
});

describe('useSendTyping', () => {
  let h: ChatTestHarness;

  beforeEach(() => {
    h = createChatHarness();
  });

  afterEach(() => {
    cleanup();
    resetChatHarnessAuth();
    vi.useRealTimers();
  });

  const mount = async (initialId: string | null = CONVERSATION_ID, connected = true) => {
    const hook = renderHook(({ id }) => useSendTyping(id), {
      wrapper: h.wrapper,
      initialProps: { id: initialId },
    });
    if (connected) await h.connect();
    else await h.settle();
    vi.useFakeTimers();
    return hook;
  };

  it('gửi chat:typing { conversationId } lên server khi đang kết nối', async () => {
    const { result } = await mount();

    act(() => result.current());

    expect(h.socket.emit).toHaveBeenCalledTimes(1);
    expect(h.socket.emit).toHaveBeenCalledWith(REALTIME_EVENTS.chatTyping, {
      conversationId: CONVERSATION_ID,
    });
  });

  it('gọi dồn dập (mỗi phím gõ) ⇒ tối đa MỘT lần mỗi khoảng giới hạn, rồi lại gửi được', async () => {
    const { result } = await mount();

    act(() => {
      result.current();
      result.current();
      result.current();
    });
    expect(h.socket.emit).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS - 1);
      result.current();
    });
    expect(h.socket.emit).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
      result.current();
    });
    expect(h.socket.emit).toHaveBeenCalledTimes(2);
  });

  it('khoảng giới hạn của client LỚN HƠN giới hạn 2 giây của server (không bị server bỏ im lặng)', () => {
    expect(TYPING_SEND_INTERVAL_MS).toBeGreaterThan(2000);
  });

  it('chưa nối ⇒ không gửi, KHÔNG tính vào giới hạn: nối xong, lần gõ kế tiếp gửi ngay', async () => {
    const { result } = await mount(CONVERSATION_ID, false);

    act(() => result.current());
    expect(h.socket.emit).not.toHaveBeenCalled();

    act(() => h.socket.serverConnects());
    act(() => result.current());

    expect(h.socket.emit).toHaveBeenCalledTimes(1);
  });

  it('chưa chọn hội thoại (null) ⇒ không gửi gì', async () => {
    const { result } = await mount(null);

    act(() => result.current());

    expect(h.socket.emit).not.toHaveBeenCalled();
  });

  it('đổi sang hội thoại khác gửi theo hội thoại mới', async () => {
    const { result, rerender } = await mount();
    act(() => result.current());

    rerender({ id: OTHER_CONVERSATION_ID });
    act(() => {
      vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS);
      result.current();
    });

    expect(h.socket.emit).toHaveBeenLastCalledWith(REALTIME_EVENTS.chatTyping, {
      conversationId: OTHER_CONVERSATION_ID,
    });
  });
});
