'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

interface AdminUsersLoadErrorProps {
  onRetry: () => void;
}

// Lỗi tải danh sách (chỉ hiện khi CHƯA có dữ liệu nào để hiện — lần tải lại ngầm lỗi không xoá danh sách đang xem). Không lộ
// message của BE; có nút thử lại.
export function AdminUsersLoadError({ onRetry }: AdminUsersLoadErrorProps) {
  const t = useTranslations('admin');

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-card p-4"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{t('usersLoadError')}</p>
          <p className="text-sm text-muted-foreground">{t('usersLoadErrorHint')}</p>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        <RotateCw aria-hidden="true" data-icon="inline-start" />
        {t('retry')}
      </Button>
    </div>
  );
}
