'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/utils';

import { classifyListTime, formatUnread } from '../chat-format';
import { useChatDateFormat } from '../hooks/useChatDateFormat';
import type { ChatRole, ConversationSummary } from '../types';
import { ChatAvatar } from './ChatAvatar';
import { CONVERSATION_ROW_CLASS } from './chat-layout.constants';

interface ConversationListItemProps {
  conversation: ConversationSummary;
  // Vai của NGƯỜI XEM: quyết định tin cuối là "của mình" (tiền tố "Bạn:") hay của đối phương.
  viewerRole: ChatRole;
  isSelected: boolean;
  // "Bây giờ" (ms) để dựng nhãn thời gian tương đối.
  now: number;
  onSelect: (conversationId: string) => void;
}

// Một dòng ở danh sách hội thoại: chữ cái đầu/logo, tên, tin cuối rút gọn, thời gian tương đối, huy hiệu chưa đọc.
// Là `<button>` (không phải link) vì chọn hội thoại là thao tác trong cùng màn hình; `aria-current` đánh dấu dòng
// đang mở. Tên và tin cuối là chữ người dùng nhập nên `truncate` trong cột `minmax(0,1fr)` — không bao giờ làm dòng
// rộng ra. Số chưa đọc có bản đọc cho trình đọc màn hình (huy hiệu tròn là `aria-hidden`).
export function ConversationListItem({
  conversation,
  viewerRole,
  isSelected,
  now,
  onSelect,
}: ConversationListItemProps) {
  const t = useTranslations('chat');
  const dateFormat = useChatDateFormat();
  const { lastMessage, lastMessageAt, unreadCount, counterpart } = conversation;
  const hasUnread = unreadCount > 0;

  const timeLabel = (() => {
    if (!lastMessageAt) return '';
    const label = classifyListTime(lastMessageAt, now);
    switch (label.kind) {
      case 'justNow':
        return t('timeJustNow');
      case 'minutes':
        return t('timeMinutes', { count: label.count });
      case 'hours':
        return t('timeHours', { count: label.count });
      case 'yesterday':
        return t('timeYesterday');
      case 'date':
        return dateFormat.shortDate(label.date);
    }
  })();

  const preview = lastMessage
    ? lastMessage.senderRole === viewerRole
      ? t('lastMessageMine', { content: lastMessage.content })
      : lastMessage.content
    : t('conversationNoMessages');

  return (
    <button
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      onClick={() => onSelect(conversation.id)}
      className={cn(
        CONVERSATION_ROW_CLASS,
        'min-h-16 transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        isSelected && 'bg-muted',
      )}
    >
      <ChatAvatar name={counterpart.name} logoUrl={counterpart.logoUrl} />

      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm text-foreground',
            hasUnread ? 'font-semibold' : 'font-medium',
          )}
        >
          {counterpart.name}
        </span>
        <span
          className={cn(
            'truncate text-sm',
            hasUnread ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {preview}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs whitespace-nowrap text-muted-foreground">{timeLabel}</span>
        {hasUnread ? (
          <>
            <Badge aria-hidden="true" className="min-w-5 justify-center px-1.5 tabular-nums">
              {formatUnread(unreadCount)}
            </Badge>
            <span className="sr-only">{t('conversationUnreadSr', { count: unreadCount })}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}
