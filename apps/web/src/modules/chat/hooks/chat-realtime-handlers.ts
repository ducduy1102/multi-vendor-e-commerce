import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatMessage, ChatMessageEvent, ChatReadPayload, ChatScope } from '../types';
import {
  adjustUnreadCount,
  bumpConversationWithMessage,
  setOtherReadMark,
  upsertServerMessage,
} from './chat-cache';
import { conversationsQueryKey, unreadCountQueryKey } from './chat-query-keys';

// Xử lý sự kiện real-time của chat thành các thay đổi cache — tách khỏi hook để test được không cần socket/React.

// Làm mới theo lô: nhiều tin đến dồn dập (hoặc nhiều tab) chỉ gây MỘT lần tải lại mỗi key thay vì một lần mỗi tin.
// Không "debounce kéo dài" (mỗi sự kiện đẩy lùi thời hạn): lần tải đầu luôn chạy sau tối đa `delayMs` kể từ sự kiện
// đầu tiên, và sự kiện đến SAU khi đã tải lại thì hẹn một lần tải mới — không sự kiện nào bị bỏ sót.
const INVALIDATE_DELAY_MS = 250;
const pendingInvalidations = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();

export function scheduleInvalidate(
  queryClient: QueryClient,
  queryKey: QueryKey,
  delayMs: number = INVALIDATE_DELAY_MS,
): void {
  let pending = pendingInvalidations.get(queryClient);
  if (!pending) {
    pending = new Map();
    pendingInvalidations.set(queryClient, pending);
  }
  const id = JSON.stringify(queryKey);
  if (pending.has(id)) return;
  const timers = pending;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void queryClient.invalidateQueries({ queryKey });
    }, delayMs),
  );
}

// `chat:message` mang `viewerRole` (vai của NGƯỜI NHẬN) và `shopId`: một người vừa mua vừa bán nhận sự kiện của cả
// hai hộp thư trên cùng một kết nối, nên mỗi phạm vi chỉ xử lý sự kiện của MÌNH.
export function matchesScope(scope: ChatScope, event: ChatMessageEvent): boolean {
  if (event.viewerRole !== scope.role) return false;
  return scope.role === 'BUYER' || event.shopId === scope.shopId;
}

// Áp một tin ĐÃ có trên server vào mọi cache của phạm vi — dùng chung cho tin tới qua real-time và phản hồi HTTP của
// chính lệnh gửi (hai đường này mang cùng một tin và có thể tới theo bất kỳ thứ tự nào; mọi bước ở đây idempotent).
// Vai của người xem chính là vai của phạm vi.
export function applyServerMessage(
  queryClient: QueryClient,
  scope: ChatScope,
  message: ChatMessage,
): void {
  // 1. Tin vào cache của hội thoại (nếu đang nạp). Dòng có cùng `clientMessageId` là bản tạm của CHÍNH MÌNH — tin
  //    thật đã tới nên gỡ khỏi hộp chờ, kể cả khi phản hồi HTTP chưa về (server đẩy sự kiện trước khi trả phản hồi).
  upsertServerMessage(queryClient, scope, message);
  if (message.clientMessageId) {
    useChatOutboxStore.getState().remove(message.conversationId, message.clientMessageId);
  }

  // 2. Dòng của hội thoại ở danh sách (tin cuối, thứ tự, chưa đọc).
  const { status, previousUnread } = bumpConversationWithMessage(
    queryClient,
    scope,
    message,
    scope.role,
  );
  // Hội thoại MỚI (tin đầu tiên) chưa có dòng trong danh sách và không có đủ dữ liệu để tự dựng (thiếu tên/logo
  // đối phương) ⇒ tải lại danh sách.
  if (status === 'missing') scheduleInvalidate(queryClient, conversationsQueryKey(scope));

  // 3. Huy hiệu tổng. Tin của đối phương ⇒ tải lại (server là nguồn đúng: tự cộng +1 sẽ đếm đôi nếu huy hiệu vừa
  //    được tải SAU khi tin tới). Tin của chính mình xoá chưa đọc của hội thoại ⇒ trừ đúng phần đó.
  if (message.senderRole !== scope.role) {
    scheduleInvalidate(queryClient, unreadCountQueryKey(scope));
  } else if (previousUnread > 0) {
    adjustUnreadCount(queryClient, scope, -previousUnread);
  }
}

export function handleIncomingMessage(
  queryClient: QueryClient,
  scope: ChatScope,
  event: ChatMessageEvent,
): void {
  if (!matchesScope(scope, event)) return;
  applyServerMessage(queryClient, scope, event.message);
}

// `chat:read`: đối phương đã đọc tới `readAt`. Payload không có phạm vi nên mốc nằm ở key không theo phạm vi.
export function handleReadReceipt(queryClient: QueryClient, payload: ChatReadPayload): void {
  setOtherReadMark(queryClient, payload.conversationId, payload.readAt);
}
