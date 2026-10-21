'use client';

import { chatMessageEventSchema, chatReadPayloadSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent';
import { useRealtimeStatus } from '@/shared/realtime/useRealtimeStatus';
import type { RealtimeStatus } from '@/shared/realtime/realtime-client';

import type { ChatScope } from '../types';
import { chatScopeQueryKey } from './chat-query-keys';
import { handleIncomingMessage, handleReadReceipt } from './chat-realtime-handlers';
import { useStableChatScope } from './useStableChatScope';

// Nối real-time vào cache của MỘT phạm vi chat (Week10.md 5.1). Gắn MỘT lần ở nơi cần dữ liệu chat luôn tươi (Header có
// huy hiệu, trang hộp thư) — mỗi phạm vi một lần: người mua `{ role: 'BUYER' }`, từng shop `{ role: 'SHOP', shopId }`.
//
//  - `chat:message` ⇒ chèn vào cache hội thoại (khử trùng theo id/clientMessageId), cập nhật dòng ở danh sách,
//    làm mới huy hiệu; chỉ xử lý sự kiện đúng phạm vi (vai + shop của người nhận).
//  - `chat:read` ⇒ ghi mốc "đối phương đã đọc tới" (cache riêng, không theo phạm vi).
//  - SAU MỖI LẦN NỐI (kể cả lần đầu và nối lại sau khi rớt mạng / API ngủ) ⇒ làm mới mọi query của phạm vi đang được
//    dùng (danh sách, huy hiệu, hội thoại đang mở) để lấp khoảng trống: sự kiện phát lúc KHÔNG có kết nối không được
//    gửi lại. Mở hook khi đã đang kết nối thì không làm mới thêm (dữ liệu vừa được nạp).
// `chat:typing` KHÔNG xử lý ở đây (trạng thái tạm theo từng hội thoại, xem useTypingIndicator).
export function useChatRealtimeSync(scope: ChatScope, options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const stableScope = useStableChatScope(scope);

  useRealtimeEvent(REALTIME_EVENTS.chatMessage, chatMessageEventSchema, (event) => {
    if (enabled) handleIncomingMessage(queryClient, stableScope, event);
  });
  useRealtimeEvent(REALTIME_EVENTS.chatRead, chatReadPayloadSchema, (payload) => {
    if (enabled) handleReadReceipt(queryClient, payload);
  });

  const status = useRealtimeStatus();
  const previousStatus = useRef<RealtimeStatus>(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (enabled && status === 'connected' && previous !== 'connected') {
      void queryClient.invalidateQueries({ queryKey: chatScopeQueryKey(stableScope) });
    }
  }, [status, enabled, queryClient, stableScope]);
}
