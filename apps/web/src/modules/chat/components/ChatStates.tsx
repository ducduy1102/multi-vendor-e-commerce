'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

interface ChatEmptyStateProps {
  title: string;
  hint?: string;
}

// Trạng thái trống dùng cho danh sách ("Chưa có cuộc trò chuyện") và khung hội thoại chưa chọn. Văn bản luôn xuống
// dòng được (`break-words`) — chuỗi dịch hoặc tên có thể dài.
export function ChatEmptyState({ title, hint }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <MessageCircle aria-hidden="true" className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium break-words text-foreground">{title}</p>
      {hint ? <p className="text-xs break-words text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface ChatErrorStateProps {
  message: string;
  onRetry: () => void;
}

// Lỗi tải (danh sách hoặc tin) kèm nút thử lại. Chỉ nhận chuỗi ĐÃ DỊCH: không bao giờ hiện `error.message` thô.
export function ChatErrorState({ message, onRetry }: ChatErrorStateProps) {
  const t = useTranslations('chat');

  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <p className="text-sm break-words text-destructive">{message}</p>
      <Button type="button" variant="outline" className="min-h-9" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
