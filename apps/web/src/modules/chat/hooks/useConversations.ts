import { useInfiniteQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { conversationsQueryKey } from './chat-query-keys';

// Hộp thư của một phạm vi (người mua, hoặc một shop): các hội thoại ĐÃ có tin, mới nhất trước, tải thêm theo con trỏ
// (`fetchNextPage`). Real-time giữ danh sách này tươi (xem useChatRealtimeSync) nên không cần thăm dò định kỳ.
// `enabled` để nơi dùng chỉ nạp khi chắc chắn đã đăng nhập (route chat đã bị chặn khách ở proxy.ts nên trang chat
// luôn bật).
export function useConversations(scope: ChatScope, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: conversationsQueryKey(scope),
    queryFn: ({ pageParam }) => chatService.listConversations(scope, { before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: shouldRetryQuery,
  });
}
