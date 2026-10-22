'use client';

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

interface NotificationEmptyStateProps {
  title: string;
  hint?: string;
}

// Trạng thái trống ("Chưa có thông báo", "Đã đọc hết"). Văn bản luôn xuống dòng được (`break-words`) — chuỗi dịch có thể dài.
export function NotificationEmptyState({ title, hint }: NotificationEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <Bell aria-hidden="true" className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium break-words text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs break-words text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface NotificationErrorStateProps {
  message: string;
  onRetry: () => void;
}

// Lỗi tải kèm nút thử lại. Chỉ nhận chuỗi ĐÃ DỊCH: không bao giờ hiện `error.message` thô (rules/frontend.md mục 10).
export function NotificationErrorState({ message, onRetry }: NotificationErrorStateProps) {
  const t = useTranslations('notification');

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 py-14 text-center"
    >
      <p className="text-sm break-words text-destructive">{message}</p>
      <Button type="button" variant="outline" className="min-h-9" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
