'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';

import { useRouter } from '@/i18n/navigation';

import { useNow } from '@/shared/hooks/useNow';
import { useConversations } from '../hooks/useConversations';
import { useSeededConversation } from '../hooks/useOpenConversation';
import { useStableChatScope } from '../hooks/useStableChatScope';
import type { ChatScope } from '../types';
import { ChatInbox } from './ChatInbox';
import { ChatEmptyState } from './ChatStates';
import { ChatThreadContainer } from './ChatThreadContainer';
import { ConversationList } from './ConversationList';

interface ChatInboxContainerProps {
  scope: ChatScope;
  // Hội thoại đang chọn (từ `?c=<id>` do page đọc qua `searchParams`), null = chưa chọn.
  selectedId: string | null;
  // Đường dẫn trang chứa hộp thư (`/chat` hoặc `/seller/chat`): chọn/quay lại đổi `?c=` trên chính trang này.
  basePath: string;
}

// Hộp thư chat hoàn chỉnh cho MỘT phạm vi (người mua, hoặc một shop). Container: nối danh sách + khung hội thoại với
// hook, giữ lựa chọn trong URL để F5/chia sẻ link/nút Back của trình duyệt đều đúng (dưới `md` Back đưa từ hội thoại
// về danh sách). Dữ liệu được giữ tươi bằng sự kiện real-time ở `ChatRealtimeSync` (shared/components, mount MỘT lần ở
// layout cho cả hai phạm vi) — container KHÔNG tự mount `useChatRealtimeSync`, hai bản cùng chạy chỉ nhân đôi việc;
// không unit test (rules/frontend.md mục 8), kiểm bằng Playwright.
export function ChatInboxContainer({ scope, selectedId, basePath }: ChatInboxContainerProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const stableScope = useStableChatScope(scope);
  const now = useNow();

  const conversations = useConversations(stableScope);
  const items = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.items) ?? [],
    [conversations.data],
  );
  const seeded = useSeededConversation(stableScope, selectedId);
  const selected = items.find((item) => item.id === selectedId) ?? seeded;

  // Mở thẳng một hội thoại nằm ngoài các trang đã tải (link cũ): nạp thêm trang cho tới khi thấy hoặc hết dữ liệu.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = conversations;
  useEffect(() => {
    if (selectedId !== null && !selected && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [selectedId, selected, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <ChatInbox
      hasSelection={selectedId !== null}
      list={
        <ConversationList
          items={items}
          viewerRole={stableScope.role}
          selectedId={selectedId}
          now={now}
          isPending={conversations.isPending}
          isError={conversations.isError}
          hasMore={conversations.hasNextPage}
          isFetchingMore={conversations.isFetchingNextPage}
          onSelect={(id) => router.push(`${basePath}?c=${encodeURIComponent(id)}`)}
          onLoadMore={() => void conversations.fetchNextPage()}
          onRetry={() => void conversations.refetch()}
        />
      }
      thread={
        selectedId !== null ? (
          <ChatThreadContainer
            key={selectedId}
            scope={stableScope}
            conversationId={selectedId}
            summary={selected}
            fallbackName={t('conversationFallbackName')}
            onBack={() => router.push(basePath)}
          />
        ) : (
          <ChatEmptyState title={t('selectPrompt')} />
        )
      }
    />
  );
}
