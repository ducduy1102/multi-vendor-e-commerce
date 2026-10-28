'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { flattenAdminNotePages } from '../admin-notes-pages';
import { useAddAdminNote } from '../hooks/useAddAdminNote';
import { useAdminNotes } from '../hooks/useAdminNotes';
import { useDescribeAdminError } from '../hooks/useDescribeAdminError';
import type { AdminNoteTargetType } from '../types';
import { AdminNoteForm } from './AdminNoteForm';
import { AdminNoteList } from './AdminNoteList';

interface AdminNotesSectionProps {
  targetType: AdminNoteTargetType;
  targetId: string;
}

// Ghi chú nội bộ của MỘT người dùng hoặc shop (Week11.md 4.3): lời nhắc chỉ Admin thấy, ô thêm ghi chú và danh sách (mới nhất
// trước, tải thêm từng trang). Nơi dùng truyền `key={targetId}` để đổi sang đối tượng khác thì ô nhập và thông báo lỗi bắt đầu
// lại từ đầu. Container nối hook với UI thuần (rules/frontend.md mục 8): không cần unit test, phần có logic đã tách ra hàm thuần
// (flattenAdminNotePages) và component thuần (AdminNoteForm, AdminNoteList, AdminNoteItem).
export function AdminNotesSection({ targetType, targetId }: AdminNotesSectionProps) {
  const t = useTranslations('admin');
  const describeError = useDescribeAdminError();
  const notesQuery = useAdminNotes({ targetType, targetId });
  const addNote = useAddAdminNote();
  const [error, setError] = useState<string | null>(null);

  async function submit(content: string): Promise<boolean> {
    setError(null);
    try {
      await addNote.mutateAsync({ targetType, targetId, content });
      return true;
    } catch (caught) {
      setError(describeError(caught));
      return false;
    }
  }

  const pages = notesQuery.data?.pages ?? [];
  const notes = flattenAdminNotePages(pages);
  const total = pages.at(-1)?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('notesPrivateHint')}</p>
      <AdminNoteForm isSubmitting={addNote.isPending} error={error} onSubmit={submit} />
      <AdminNoteList
        isPending={notesQuery.isPending}
        isError={notesQuery.isError}
        notes={notes}
        total={total}
        hasNextPage={notesQuery.hasNextPage}
        isFetchingNextPage={notesQuery.isFetchingNextPage}
        onRetry={() => void notesQuery.refetch()}
        onLoadMore={() => void notesQuery.fetchNextPage()}
      />
    </div>
  );
}
