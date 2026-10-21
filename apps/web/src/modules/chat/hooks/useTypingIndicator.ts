'use client';

import { chatMessageEventSchema, chatTypingPayloadSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRealtimeEmit } from '@/shared/realtime/useRealtimeEmit';
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent';

// Tín hiệu "đang gõ" chỉ có nghĩa vài giây: client gửi mỗi ~2,5 giây khi người dùng đang gõ (server giới hạn 1 tín
// hiệu/2 giây/hội thoại và bỏ im lặng phần thừa), còn phía nhận tự tắt nếu 4 giây không nhận thêm tín hiệu (người kia
// ngừng gõ, hoặc mất kết nối giữa chừng).
export const TYPING_EXPIRE_MS = 4_000;
export const TYPING_SEND_INTERVAL_MS = 2_500;

// Đối phương có đang gõ trong hội thoại này không. Trạng thái tạm thuần client (không đi vào cache server state):
// bật khi nhận `chat:typing` của hội thoại này, tự tắt sau TYPING_EXPIRE_MS, và tắt NGAY khi tin của đối phương tới
// (họ gõ xong và đã gửi). Đổi hội thoại hoặc gỡ component ⇒ tắt và dọn hẹn giờ.
export function useTypingIndicator(conversationId: string | null): boolean {
  const [isTyping, setIsTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setIsTyping(false);
  }, []);

  useRealtimeEvent(REALTIME_EVENTS.chatTyping, chatTypingPayloadSchema, (payload) => {
    if (conversationId === null || payload.conversationId !== conversationId) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setIsTyping(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setIsTyping(false);
    }, TYPING_EXPIRE_MS);
  });

  useRealtimeEvent(REALTIME_EVENTS.chatMessage, chatMessageEventSchema, (event) => {
    const isFromOtherSide = event.message.senderRole !== event.viewerRole;
    if (isFromOtherSide && event.message.conversationId === conversationId) stop();
  });

  useEffect(() => stop, [conversationId, stop]);

  return isTyping;
}

// Báo cho đối phương biết mình đang gõ. Gọi hàm trả về MỖI lần người dùng thay đổi ô nhập: nó tự giới hạn (tối đa 1
// lần/TYPING_SEND_INTERVAL_MS) và chỉ gửi khi đang kết nối (không xếp hàng — gửi muộn là sai sự thật). Một lần
// không gửi được vì chưa nối KHÔNG tính vào khoảng giới hạn, nên lần gõ kế tiếp thử lại ngay.
export function useSendTyping(conversationId: string | null): () => void {
  const emit = useRealtimeEmit();
  const lastSentAt = useRef(0);

  return useCallback(() => {
    if (conversationId === null) return;
    const now = Date.now();
    if (now - lastSentAt.current < TYPING_SEND_INTERVAL_MS) return;
    if (emit(REALTIME_EVENTS.chatTyping, { conversationId })) lastSentAt.current = now;
  }, [conversationId, emit]);
}
