'use client';

import { useState, type ReactNode } from 'react';

import { useRealtimeStatus } from '@/shared/realtime/useRealtimeStatus';
import { useNow } from '@/shared/hooks/useNow';

import { useDescribeChatError } from '../hooks/useDescribeChatError';
import { useMarkReadWhileOpen } from '../hooks/useMarkReadWhileOpen';
import { useMessages } from '../hooks/useMessages';
import { useOtherReadMark } from '../hooks/useOtherReadMark';
import { useSendMessage } from '../hooks/useSendMessage';
import { useStableChatScope } from '../hooks/useStableChatScope';
import { useSendTyping, useTypingIndicator } from '../hooks/useTypingIndicator';
import type { ChatScope, ConversationSummary } from '../types';
import { ChatThread } from './ChatThread';

interface ChatThreadContainerProps {
  scope: ChatScope;
  conversationId: string;
  // Bản tóm tắt của hội thoại (từ danh sách hoặc từ lúc vừa mở). undefined khi hội thoại nằm ngoài các trang đã tải
  // — vẫn đọc/gửi được, chỉ thiếu tên đối phương.
  summary: ConversationSummary | undefined;
  fallbackName: string;
  onBack: () => void;
  reportSlot?: ReactNode;
}

// Nối các hook của MỘT hội thoại vào ChatThread (Container: nối UI thuần với hook, không viết logic riêng, không cần
// unit test — rules/frontend.md mục 8). Nơi dùng đặt `key={conversationId}` để đổi hội thoại là dựng mới hoàn toàn
// (trạng thái cuộn, bản nháp ô nhập, cờ "đã từng nối" đều khởi tạo lại).
export function ChatThreadContainer({
  scope,
  conversationId,
  summary,
  fallbackName,
  onBack,
  reportSlot,
}: ChatThreadContainerProps) {
  const stableScope = useStableChatScope(scope);
  const messages = useMessages(stableScope, conversationId);
  const { send, retry, discard } = useSendMessage(stableScope, conversationId);
  const isCounterpartTyping = useTypingIndicator(conversationId);
  const sendTyping = useSendTyping(conversationId);
  const otherLastReadAt = useOtherReadMark(conversationId, summary?.otherLastReadAt);
  useMarkReadWhileOpen(stableScope, conversationId, summary?.unreadCount ?? 0);
  const now = useNow();
  const { describeFailure, describeLoadError } = useDescribeChatError();

  // "Mất kết nối" chỉ có nghĩa SAU khi đã từng nối được: lúc mới mở trang trạng thái là 'connecting'/'offline' trong
  // chốc lát, báo mất kết nối ngay lúc đó là báo sai.
  const status = useRealtimeStatus();
  const [hasConnected, setHasConnected] = useState(false);
  if (status === 'connected' && !hasConnected) setHasConnected(true);

  return (
    <ChatThread
      counterpartName={summary?.counterpart.name ?? fallbackName}
      counterpartLogoUrl={summary?.counterpart.logoUrl ?? null}
      viewerRole={stableScope.role}
      isReadOnly={summary?.isReadOnly ?? false}
      items={messages.items}
      isPending={messages.isPending}
      loadErrorMessage={messages.isError ? describeLoadError(messages.error) : null}
      hasOlder={messages.hasOlder}
      isFetchingOlder={messages.isFetchingOlder}
      otherLastReadAt={otherLastReadAt}
      isCounterpartTyping={isCounterpartTyping}
      isConnectionLost={hasConnected && status !== 'connected'}
      now={now}
      describeFailure={describeFailure}
      onBack={onBack}
      onFetchOlder={messages.fetchOlder}
      onReload={messages.refetch}
      onSend={send}
      onTyping={sendTyping}
      onRetrySend={retry}
      onDiscard={discard}
      reportSlot={reportSlot}
    />
  );
}
