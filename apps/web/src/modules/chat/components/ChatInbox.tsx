'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

import { CHAT_INBOX_CLASS } from './chat-layout.constants';

interface ChatInboxProps {
  // Có hội thoại đang chọn hay không. Từ `md`: luôn hai cột (danh sách | hội thoại). Dưới `md`: một màn tại một
  // thời điểm — danh sách khi chưa chọn, hội thoại (có nút quay lại) khi đã chọn.
  hasSelection: boolean;
  list: ReactNode;
  thread: ReactNode;
}

// Bố cục hộp thư (component THUẦN, chỉ lo khung): hai vùng có nhãn cho trình đọc màn hình. Ẩn/hiện bằng CSS chứ không
// dựng hai bản: mỗi vùng chỉ có MỘT bản trong DOM. Chiều cao cố định theo khung nhìn (xem CHAT_INBOX_CLASS) để chỉ
// danh sách và khung tin cuộn.
export function ChatInbox({ hasSelection, list, thread }: ChatInboxProps) {
  const t = useTranslations('chat');

  return (
    <div className={CHAT_INBOX_CLASS}>
      <section
        aria-label={t('listLabel')}
        className={cn(
          'min-h-0 min-w-0 flex-col md:flex md:border-r md:border-border',
          hasSelection ? 'hidden' : 'flex',
        )}
      >
        {list}
      </section>
      <section
        aria-label={t('threadLabel')}
        className={cn('min-h-0 min-w-0 flex-col md:flex', hasSelection ? 'flex' : 'hidden')}
      >
        {thread}
      </section>
    </div>
  );
}
