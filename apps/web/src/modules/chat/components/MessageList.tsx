'use client';

import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/shared/components/ui/button';

import { classifyDay, groupMessages } from '../chat-format';
import { toPreview } from '../chat-preview';
import { isSeenByOther, type ChatMessageView } from '../hooks/chat-messages';
import { useChatDateFormat } from '../hooks/useChatDateFormat';
import type { ChatRole, ChatSendFailure } from '../types';
import { MessageBubble } from './MessageBubble';

// Cách đáy bao nhiêu px vẫn coi là "đang ở gần đáy" (tin mới tự cuộn xuống). Rộng hơn 0 vì người dùng hiếm khi dừng
// đúng sát đáy, và cuộn quán tính của trình duyệt dừng lệch vài px.
const NEAR_BOTTOM_PX = 80;

interface MessageListProps {
  // MỚI NHẤT trước (đúng thứ tự `useMessages` trả); component tự đảo khi hiển thị cũ → mới.
  items: ChatMessageView[];
  viewerRole: ChatRole;
  counterpartName: string;
  // Mốc đối phương đã đọc tới, cho dấu "Đã xem" ở tin cuối của mình.
  otherLastReadAt: string | null;
  hasOlder: boolean;
  isFetchingOlder: boolean;
  // "Bây giờ" (ms) để dựng nhãn "Hôm nay"/"Hôm qua".
  now: number;
  describeFailure: (failure: ChatSendFailure) => string;
  onFetchOlder: () => void;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

// Khung tin của MỘT hội thoại (component THUẦN). Quy tắc cuộn — đúng thứ người dùng mong đợi ở ứng dụng chat:
//  - Lần đầu có tin: xuống đáy (tin mới nhất).
//  - Tin mới ở đáy: CHỈ tự cuộn xuống khi đang ở gần đáy, hoặc khi đó là tin do chính mình gửi. Đang đọc phía trên
//    thì KHÔNG giật khung đi mất chỗ đang đọc — hiện chip "Tin mới" để bấm xuống.
//  - "Tải tin cũ hơn": tin chèn lên ĐẦU danh sách nhưng giữ nguyên chỗ đang đọc (bù đúng phần cao thêm vào).
// Mỗi hội thoại phải có `key` riêng ở nơi gọi — đổi hội thoại là dựng khung mới (trạng thái cuộn khởi tạo lại),
// không dọn tay.
//
// Trình đọc màn hình: tin mới của ĐỐI PHƯƠNG được đọc qua một vùng `aria-live="polite"` riêng, chỉ chứa tin mới nhất
// (không phải cả khung tin — vùng live bao cả danh sách sẽ đọc luôn toàn bộ tin cũ mỗi khi bấm "Tải tin cũ hơn").
//
// Trạng thái dẫn xuất từ props dùng mẫu "lưu giá trị lần render trước" (setState có điều kiện ngay trong render, React
// cho phép) thay vì setState trong effect, vì effect chỉ chạm DOM (cuộn).
export function MessageList({
  items,
  viewerRole,
  counterpartName,
  otherLastReadAt,
  hasOlder,
  isFetchingOlder,
  now,
  describeFailure,
  onFetchOlder,
  onRetry,
  onDiscard,
}: MessageListProps) {
  const t = useTranslations('chat');
  const dateFormat = useChatDateFormat();
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Chiều cao nội dung ngay trước khi tải tin cũ (để bù vị trí cuộn sau khi tin chèn lên đầu).
  const heightBeforeOlder = useRef<number | null>(null);
  const previous = useRef<{ newestId: string | null; oldestId: string | null } | null>(null);

  const newestId = items[0]?.id ?? null;
  const oldestId = items.at(-1)?.id ?? null;

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [seenNewestId, setSeenNewestId] = useState<string | null>(newestId);
  const [trackedNewestId, setTrackedNewestId] = useState<string | null>(newestId);
  const [announcement, setAnnouncement] = useState('');

  if (newestId !== trackedNewestId) {
    setTrackedNewestId(newestId);
    const newest = items[0];
    // Chỉ đọc tin mới của đối phương xuất hiện SAU khi khung đã có tin (lần nạp đầu không được đọc).
    if (trackedNewestId !== null && newest && newest.senderRole !== viewerRole) {
      setAnnouncement(
        t('newMessageAnnounce', { name: counterpartName, content: toPreview(newest.content) }),
      );
    }
  }
  // Đang ở đáy ⇒ mọi tin đều đã thấy.
  if (isAtBottom && seenNewestId !== newestId) setSeenNewestId(newestId);

  // Chip "Tin mới" chỉ đếm tin của ĐỐI PHƯƠNG: tin mình vừa gửi luôn kéo khung xuống đáy, và trong khoảnh khắc trước
  // khi trình duyệt phát sự kiện cuộn, chip không được nháy lên vì chính tin của mình.
  const unseenCount = (() => {
    if (isAtBottom) return 0;
    const index = items.findIndex((item) => item.id === seenNewestId);
    if (index === -1) return 0;
    return items.slice(0, index).filter((item) => item.senderRole !== viewerRole).length;
  })();

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const before = previous.current;
    previous.current = { newestId, oldestId };

    if (!before || (before.newestId === null && newestId !== null)) {
      scroller.scrollTop = scroller.scrollHeight;
    } else if (newestId !== before.newestId) {
      const isOwn = items[0]?.senderRole === viewerRole;
      if (isAtBottom || isOwn) scroller.scrollTop = scroller.scrollHeight;
    } else if (oldestId !== before.oldestId && heightBeforeOlder.current !== null) {
      scroller.scrollTop += scroller.scrollHeight - heightBeforeOlder.current;
    }
    if (oldestId !== before?.oldestId) heightBeforeOlder.current = null;
  }, [items, newestId, oldestId, isAtBottom, viewerRole]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setIsAtBottom(
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= NEAR_BOTTOM_PX,
    );
  };

  const handleFetchOlder = () => {
    heightBeforeOlder.current = scrollerRef.current?.scrollHeight ?? null;
    onFetchOlder();
  };

  const scrollToBottom = () => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  const days = groupMessages(items);
  // Tin cuối của MÌNH mà đối phương đã đọc tới (items mới nhất trước ⇒ cái đầu tiên khớp là mới nhất).
  const seenMessageId = items.find((item) => isSeenByOther(item, viewerRole, otherLastReadAt))?.id;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={t('threadLabel')}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {hasOlder ? (
          <div className="mb-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetchingOlder}
              onClick={handleFetchOlder}
            >
              {isFetchingOlder ? t('loadingOlder') : t('loadOlder')}
            </Button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4">
          {days.map((day) => {
            const label = classifyDay(day.firstAt, now);
            return (
              <section key={day.key} className="grid grid-cols-1 gap-3">
                <p className="text-center text-xs text-muted-foreground">
                  {label.kind === 'today'
                    ? t('dayToday')
                    : label.kind === 'yesterday'
                      ? t('dayYesterday')
                      : dateFormat.fullDate(label.date)}
                </p>
                {day.runs.map((run) => (
                  <ul key={run.messages[0].id} className="grid grid-cols-1 gap-1">
                    {run.messages.map((message, index) => (
                      <li key={message.id} className="min-w-0">
                        <MessageBubble
                          message={message}
                          isOwn={message.senderRole === viewerRole}
                          counterpartName={counterpartName}
                          showTime={index === run.messages.length - 1}
                          isSeen={message.id === seenMessageId}
                          describeFailure={describeFailure}
                          onRetry={onRetry}
                          onDiscard={onDiscard}
                        />
                      </li>
                    ))}
                  </ul>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {unseenCount > 0 ? (
        <Button
          type="button"
          size="sm"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
        >
          <ArrowDown aria-hidden="true" />
          {t('newMessagesChip')}
        </Button>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
