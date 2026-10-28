'use client';

import { useTranslations } from 'next-intl';

import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminNote } from '../types';

interface AdminNoteItemProps {
  note: AdminNote;
}

// Một ghi chú nội bộ: ai viết, lúc nào, nội dung. Render <li>: nơi dùng bọc trong <ul>. Component THUẦN trình bày. Nội dung do Admin
// tự nhập (có thể nhiều dòng, có thể dán chuỗi dài không dấu cách) nên hiện dạng text (React tự escape), giữ xuống dòng và bẻ dòng
// bằng `overflow-wrap: anywhere` để không làm ngăn rộng ra.
export function AdminNoteItem({ note }: AdminNoteItemProps) {
  const t = useTranslations('admin');
  const formatDateTime = useFormatAdminDateTime();

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground [overflow-wrap:anywhere]">
          {note.authorName ?? t('notesAuthorUnknown')}
        </span>
        <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
      </p>
      <p className="text-sm whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]">
        {note.content}
      </p>
    </li>
  );
}
