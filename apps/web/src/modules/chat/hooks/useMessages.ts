import { skipToken, useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as chatService from '../services/chat.service';
import { EMPTY_OUTBOX, useChatOutboxStore } from '../store/chat-outbox.store';
import type { ChatScope } from '../types';
import { messagesQueryKey } from './chat-query-keys';
import {
  flattenServerMessages,
  mergeMessagesWithOutbox,
  type ChatMessageView,
} from './chat-messages';
import { useStableChatScope } from './useStableChatScope';

export interface UseMessagesResult {
  // MỚI NHẤT trước: tin đang gửi / gửi lỗi của chính mình ở trên cùng, rồi tới tin từ server. Giao diện đảo ngược
  // khi cần hiển thị cũ → mới.
  items: ChatMessageView[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  // Còn tin CŨ hơn chưa tải.
  hasOlder: boolean;
  isFetchingOlder: boolean;
  fetchOlder: () => void;
  refetch: () => void;
}

// Tin của một hội thoại: các trang tải bằng con trỏ (`fetchOlder` = "Tải tin cũ hơn"), ghép với hộp chờ gửi của chính
// mình. `conversationId = null` (chưa chọn hội thoại) ⇒ không tải gì. Tin mới tới qua real-time được chèn thẳng vào
// cache bởi useChatRealtimeSync (khử trùng theo id/clientMessageId) nên không cần thăm dò.
export function useMessages(scope: ChatScope, conversationId: string | null): UseMessagesResult {
  const stableScope = useStableChatScope(scope);
  const query = useInfiniteQuery({
    queryKey: messagesQueryKey(stableScope, conversationId ?? ''),
    queryFn:
      conversationId === null
        ? skipToken
        : ({ pageParam }) =>
            chatService.listMessages(stableScope, conversationId, { before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: shouldRetryQuery,
  });
  const outbox = useChatOutboxStore((state) =>
    conversationId === null ? undefined : state.byConversation[conversationId],
  );

  const data = query.data;
  const items = useMemo(
    () => mergeMessagesWithOutbox(flattenServerMessages(data), outbox ?? EMPTY_OUTBOX),
    [data, outbox],
  );
  const { fetchNextPage, refetch } = query;
  const fetchOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const reload = useCallback(() => void refetch(), [refetch]);

  return {
    items,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    fetchOlder,
    refetch: reload,
  };
}
