'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';

import type { AdminNote } from '../types';
import { AdminNoteItem } from './AdminNoteItem';

interface AdminNoteListProps {
  // Lần tải đầu chưa xong.
  isPending: boolean;
  // Lỗi VÀ chưa có gì để hiện: có dữ liệu thì luôn hiện dữ liệu (lần làm mới ngầm lỗi không được xoá danh sách đang xem).
  isError: boolean;
  notes: AdminNote[];
  // Tổng số ghi chú của đối tượng (kể cả chưa tải) — để báo còn bao nhiêu ghi chú cũ hơn.
  total: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}

// Danh sách ghi chú nội bộ với đủ bốn trạng thái (rules/frontend.md mục 10): đang tải (skeleton), lỗi (thử lại được), rỗng, và
// danh sách kèm nút "xem ghi chú cũ hơn". Component THUẦN trình bày; dữ liệu, phân trang và thử lại do Container nối.
export function AdminNoteList({
  isPending,
  isError,
  notes,
  total,
  hasNextPage,
  isFetchingNextPage,
  onRetry,
  onLoadMore,
}: AdminNoteListProps) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  if (isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <div aria-hidden="true" className="flex flex-col gap-2">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    );
  }

  if (isError && notes.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{t('notesLoadError')}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (notes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('notesEmpty')}</p>;
  }

  const remaining = Math.max(total - notes.length, 0);

  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={t('notesListLabel')} className="flex flex-col gap-2">
        {notes.map((note) => (
          <AdminNoteItem key={note.id} note={note} />
        ))}
      </ul>
      {hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={isFetchingNextPage}
          aria-busy={isFetchingNextPage || undefined}
          onClick={onLoadMore}
        >
          {isFetchingNextPage ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {t('notesLoadMore', { count: remaining })}
        </Button>
      ) : null}
    </div>
  );
}
