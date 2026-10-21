'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

import type { ChatRole, ConversationSummary } from '../types';
import { ChatEmptyState, ChatErrorState } from './ChatStates';
import { ConversationListItem } from './ConversationListItem';
import { ConversationListSkeleton } from './ConversationListSkeleton';

interface ConversationListProps {
  items: ConversationSummary[];
  viewerRole: ChatRole;
  selectedId: string | null;
  now: number;
  isPending: boolean;
  isError: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  onSelect: (conversationId: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

// Cột danh sách hội thoại (component THUẦN — dữ liệu và hành động qua props). Đủ ba trạng thái: đang tải (skeleton),
// lỗi (có nút thử lại), trống (lời gợi ý khác nhau cho người mua và chủ shop). Danh sách dài cuộn BÊN TRONG cột;
// "Xem thêm" ở cuối vì phân trang theo con trỏ (hội thoại mới nhất trước).
export function ConversationList({
  items,
  viewerRole,
  selectedId,
  now,
  isPending,
  isError,
  hasMore,
  isFetchingMore,
  onSelect,
  onLoadMore,
  onRetry,
}: ConversationListProps) {
  const t = useTranslations('chat');

  if (isPending) {
    return (
      <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
        <span className="sr-only">{t('listLoadingSrOnly')}</span>
        <ConversationListSkeleton />
      </div>
    );
  }

  if (isError && items.length === 0) {
    return <ChatErrorState message={t('listError')} onRetry={onRetry} />;
  }

  if (items.length === 0) {
    return (
      <ChatEmptyState
        title={t('listEmptyTitle')}
        hint={viewerRole === 'BUYER' ? t('listEmptyBuyerHint') : t('listEmptySellerHint')}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ul className="divide-y divide-border">
        {items.map((conversation) => (
          <li key={conversation.id}>
            <ConversationListItem
              conversation={conversation}
              viewerRole={viewerRole}
              isSelected={conversation.id === selectedId}
              now={now}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="flex justify-center border-t border-border p-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={isFetchingMore}
            onClick={onLoadMore}
          >
            {isFetchingMore ? t('listLoadingMore') : t('listLoadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
