import type { AdminNote, AdminNoteListResponse } from './types';

// Dữ liệu giả cho test ghi chú nội bộ (Week11.md 4.3).
export function makeNote(overrides: Partial<AdminNote> = {}): AdminNote {
  return {
    id: 'note-1',
    targetType: 'SHOP',
    targetId: '11111111-1111-4111-8111-111111111111',
    content: 'Chủ shop đã gọi lại, hẹn bổ sung giấy phép.',
    authorId: 'admin-1',
    authorName: 'Quản trị viên An',
    createdAt: '2026-10-28T10:30:00.000Z',
    ...overrides,
  };
}

export function makeNotePage(
  items: AdminNote[],
  overrides: Partial<Omit<AdminNoteListResponse, 'items'>> = {},
): AdminNoteListResponse {
  return { items, total: items.length, page: 1, limit: 20, ...overrides };
}
