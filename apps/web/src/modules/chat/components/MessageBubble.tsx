'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import { isRetryableFailure } from '../chat-format';
import type { ChatMessageView } from '../hooks/chat-messages';
import { useChatDateFormat } from '../hooks/useChatDateFormat';
import type { ChatSendFailure } from '../types';

interface MessageBubbleProps {
  message: ChatMessageView;
  // Tin của chính người xem (căn phải, nền màu chủ đạo).
  isOwn: boolean;
  // Tên đối phương, cho bản đọc của trình đọc màn hình ("Shop Áo: ...").
  counterpartName: string;
  // Hiện giờ gửi dưới bong bóng (chỉ tin cuối của mỗi nhóm).
  showTime: boolean;
  // Hiện "Đã xem" dưới bong bóng (chỉ tin cuối của mình mà đối phương đã đọc tới).
  isSeen: boolean;
  describeFailure: (failure: ChatSendFailure) => string;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

// Một tin nhắn. Nội dung là CHỮ THUẦN do người dùng nhập: React tự escape, KHÔNG tự biến thành link và không bao giờ
// dùng dangerouslySetInnerHTML (rules chat: `<img onerror>` hiện đúng như chữ). Xuống dòng giữ nguyên
// (`whitespace-pre-wrap`); chuỗi dài không dấu cách phải bẻ được (`overflow-wrap:anywhere` — khác `break-words` ở chỗ
// nó còn thu nhỏ min-content, nên bong bóng không bao giờ làm cột rộng ra).
//
// Tin của mình có ba trạng thái dưới bong bóng: "Đang gửi...", "Gửi lỗi — <lý do>" kèm "Thử lại"/"Xoá" (chỉ cho thử
// lại khi lần sau có thể qua), hoặc giờ gửi / "Đã xem".
export function MessageBubble({
  message,
  isOwn,
  counterpartName,
  showTime,
  isSeen,
  describeFailure,
  onRetry,
  onDiscard,
}: MessageBubbleProps) {
  const t = useTranslations('chat');
  const dateFormat = useChatDateFormat();
  const { deliveryStatus, failure, clientMessageId } = message;
  const isFailed = deliveryStatus === 'failed';

  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap',
          isOwn
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
          deliveryStatus === 'sending' && 'opacity-70',
          isFailed && 'ring-2 ring-destructive',
        )}
      >
        <span className="sr-only">{isOwn ? t('senderYou') : counterpartName}: </span>
        {message.content}
      </div>

      {deliveryStatus === 'sending' ? (
        <p className="text-xs text-muted-foreground">{t('statusSending')}</p>
      ) : null}

      {isFailed ? (
        <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1 text-xs">
          <p role="alert" className="text-right break-words text-destructive">
            {t('statusFailed')}
            {failure ? ` — ${describeFailure(failure)}` : ''}
          </p>
          <div className="flex items-center gap-1">
            {clientMessageId && (!failure || isRetryableFailure(failure)) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRetry(clientMessageId)}
              >
                {t('retry')}
              </Button>
            ) : null}
            {clientMessageId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDiscard(clientMessageId)}
              >
                {t('actionDiscard')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!deliveryStatus && (showTime || isSeen) ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {showTime ? (
            <time dateTime={message.createdAt}>{dateFormat.time(message.createdAt)}</time>
          ) : null}
          {showTime && isSeen ? <span aria-hidden="true">·</span> : null}
          {isSeen ? <span>{t('statusSeen')}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
