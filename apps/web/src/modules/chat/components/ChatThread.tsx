'use client';

import { useTranslations } from 'next-intl';

import type { ChatMessageView } from '../hooks/chat-messages';
import type { ChatRole, ChatSendFailure } from '../types';
import { ChatEmptyState, ChatErrorState } from './ChatStates';
import { ConversationHeader } from './ConversationHeader';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { MessageListSkeleton } from './MessageListSkeleton';

interface ChatThreadProps {
  counterpartName: string;
  counterpartLogoUrl: string | null;
  viewerRole: ChatRole;
  // Hội thoại chỉ đọc (shop bị khoá): ô nhập bị tắt kèm lý do.
  isReadOnly: boolean;

  // Dữ liệu tin (từ useMessages) — MỚI NHẤT trước.
  items: ChatMessageView[];
  isPending: boolean;
  // Lỗi tải ĐÃ dịch (null = không lỗi). Có lỗi mà đã có tin thì vẫn hiện tin cũ (lỗi chỉ ảnh hưởng lần tải lại).
  loadErrorMessage: string | null;
  hasOlder: boolean;
  isFetchingOlder: boolean;

  otherLastReadAt: string | null;
  isCounterpartTyping: boolean;
  // Đã từng nối real-time nhưng đang mất kết nối: hiện dòng báo (vẫn gửi được qua REST).
  isConnectionLost: boolean;
  now: number;
  describeFailure: (failure: ChatSendFailure) => string;

  onBack: () => void;
  onFetchOlder: () => void;
  onReload: () => void;
  onSend: (content: string) => void;
  onTyping: () => void;
  onRetrySend: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

// Khung hội thoại hoàn chỉnh (component THUẦN, mọi dữ liệu/hành động qua props): tiêu đề, khung tin, dòng trạng thái
// (đang gõ / mất kết nối), ô nhập. Bố cục cột flex `min-h-0`: chỉ khung tin cuộn, tiêu đề và ô nhập đứng yên.
// Dòng "đang nhập" luôn chiếm chỗ (`min-h-5`) kể cả khi trống để khung tin không nhảy lên xuống mỗi lần đối phương
// bắt đầu/ngừng gõ. Ô nhập chỉ bị tắt khi hội thoại chỉ đọc (có lý do bằng chữ), KHÔNG tắt khi mất kết nối.
export function ChatThread({
  counterpartName,
  counterpartLogoUrl,
  viewerRole,
  isReadOnly,
  items,
  isPending,
  loadErrorMessage,
  hasOlder,
  isFetchingOlder,
  otherLastReadAt,
  isCounterpartTyping,
  isConnectionLost,
  now,
  describeFailure,
  onBack,
  onFetchOlder,
  onReload,
  onSend,
  onTyping,
  onRetrySend,
  onDiscard,
}: ChatThreadProps) {
  const t = useTranslations('chat');
  const hasMessages = items.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ConversationHeader
        name={counterpartName}
        logoUrl={counterpartLogoUrl}
        isReadOnly={isReadOnly}
        onBack={onBack}
      />

      {isConnectionLost ? (
        <p
          role="status"
          className="border-b border-border bg-muted px-3 py-1.5 text-xs break-words text-muted-foreground"
        >
          {t('connectionLost')}
        </p>
      ) : null}

      {isPending ? (
        <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
          <span className="sr-only">{t('threadLoadingSrOnly')}</span>
          <MessageListSkeleton />
        </div>
      ) : loadErrorMessage !== null && !hasMessages ? (
        <ChatErrorState message={loadErrorMessage} onRetry={onReload} />
      ) : !hasMessages ? (
        <ChatEmptyState
          title={viewerRole === 'BUYER' ? t('threadEmptyBuyer') : t('threadEmptySeller')}
        />
      ) : (
        <MessageList
          items={items}
          viewerRole={viewerRole}
          counterpartName={counterpartName}
          otherLastReadAt={otherLastReadAt}
          hasOlder={hasOlder}
          isFetchingOlder={isFetchingOlder}
          now={now}
          describeFailure={describeFailure}
          onFetchOlder={onFetchOlder}
          onRetry={onRetrySend}
          onDiscard={onDiscard}
        />
      )}

      <p className="min-h-5 truncate px-3 text-xs text-muted-foreground" aria-hidden="true">
        {isCounterpartTyping ? t('typingIndicator', { name: counterpartName }) : ''}
      </p>

      <MessageComposer
        onSend={onSend}
        onTyping={onTyping}
        disabledReason={
          isReadOnly
            ? viewerRole === 'BUYER'
              ? t('composerReadOnlyBuyer')
              : t('composerReadOnlySeller')
            : null
        }
      />
    </div>
  );
}
