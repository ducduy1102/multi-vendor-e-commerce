import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { adjustUnreadCount, clearConversationUnread } from './chat-cache';
import { conversationsQueryKey, unreadCountQueryKey } from './chat-query-keys';
import { useStableChatScope } from './useStableChatScope';

// Đánh dấu một hội thoại đã đọc tới tin mới nhất. LẠC QUAN: số chưa đọc của hội thoại về 0 và huy hiệu tổng giảm đúng
// phần đó NGAY, không chờ phản hồi. Lỗi ⇒ tải lại danh sách + huy hiệu để lấy lại số đúng của server. Server idempotent
// (mốc chỉ tăng, gọi lặp không đẩy thêm sự kiện) nên nơi gọi chỉ cần gọi khi hội thoại đang mở và có `unreadCount > 0`.
export function useMarkRead(scope: ChatScope) {
  const queryClient = useQueryClient();
  const stableScope = useStableChatScope(scope);

  return useMutation({
    mutationFn: (conversationId: string) => chatService.markRead(stableScope, conversationId),
    onMutate: (conversationId) => {
      const previousUnread = clearConversationUnread(queryClient, stableScope, conversationId);
      adjustUnreadCount(queryClient, stableScope, -previousUnread);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsQueryKey(stableScope) });
      void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey(stableScope) });
    },
  });
}
