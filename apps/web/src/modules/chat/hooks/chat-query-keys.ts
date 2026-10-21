import type { ChatScope } from '../types';

// Mọi query key của module chat khai ở ĐÂY (một chỗ duy nhất, như order-query-keys.ts) — hook đọc, hook mutation và
// bộ xử lý real-time dùng chung nên không bao giờ gõ tay hai nơi rồi lệch nhau.

// Tiền tố của MỌI query theo phạm vi: người mua `['chat', 'buyer']`, chủ shop `['chat', 'shop', shopId]`. Hộp thư
// người mua và hộp thư của từng shop tách bạch (một người có thể vừa mua vừa bán). Làm mới tiền tố này (sau khi
// nối lại real-time) kéo theo danh sách, huy hiệu và mọi hội thoại đang mở của phạm vi đó.
export function chatScopeQueryKey(scope: ChatScope) {
  return scope.role === 'BUYER'
    ? (['chat', 'buyer'] as const)
    : (['chat', 'shop', scope.shopId] as const);
}

export function conversationsQueryKey(scope: ChatScope) {
  return [...chatScopeQueryKey(scope), 'conversations'] as const;
}

export function unreadCountQueryKey(scope: ChatScope) {
  return [...chatScopeQueryKey(scope), 'unread'] as const;
}

export function messagesQueryKey(scope: ChatScope, conversationId: string) {
  return [...chatScopeQueryKey(scope), 'messages', conversationId] as const;
}

// Tóm tắt một hội thoại do `useOpenConversation` ghi vào (hội thoại vừa mở chưa có tin nên CHƯA nằm trong danh sách,
// mà giao diện vẫn cần tên + logo đối phương để dựng tiêu đề). Không bao giờ được fetch (xem useSeededConversation).
export function seededConversationQueryKey(scope: ChatScope, conversationId: string) {
  return [...chatScopeQueryKey(scope), 'conversation', conversationId] as const;
}

// Mốc "đối phương đã đọc tới" của một hội thoại, do sự kiện `chat:read` ghi vào. KHÔNG phụ thuộc phạm vi vì payload
// sự kiện chỉ có `conversationId` (id hội thoại duy nhất toàn hệ thống) và nằm ngoài tiền tố phạm vi nên việc làm
// mới theo phạm vi không xoá nó.
export function otherReadMarkQueryKey(conversationId: string) {
  return ['chat', 'read', conversationId] as const;
}
