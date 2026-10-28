import { describe, expect, it } from 'vitest';

import { makeNote, makeNotePage } from './admin-note.fixtures';
import {
  ADMIN_NOTES_PAGE_SIZE,
  flattenAdminNotePages,
  getNextAdminNotesPage,
} from './admin-notes-pages';

describe('flattenAdminNotePages', () => {
  it('nối các trang theo thứ tự đã tải (mới nhất trước)', () => {
    const pages = [
      makeNotePage([makeNote({ id: 'a' }), makeNote({ id: 'b' })]),
      makeNotePage([makeNote({ id: 'c' })], { page: 2 }),
    ];

    expect(flattenAdminNotePages(pages).map((note) => note.id)).toEqual(['a', 'b', 'c']);
  });

  it('khử trùng theo id, giữ lần xuất hiện ĐẦU TIÊN: ghi chú mới chen vào đầu danh sách giữa hai lần tải đẩy dòng cuối trang trước sang trang sau', () => {
    const pages = [
      makeNotePage([makeNote({ id: 'a' }), makeNote({ id: 'b' })]),
      makeNotePage([makeNote({ id: 'b' }), makeNote({ id: 'c' })], { page: 2 }),
    ];

    const flat = flattenAdminNotePages(pages);

    expect(flat.map((note) => note.id)).toEqual(['a', 'b', 'c']);
  });

  it('không có trang nào hoặc trang rỗng ⇒ mảng rỗng', () => {
    expect(flattenAdminNotePages([])).toEqual([]);
    expect(flattenAdminNotePages([makeNotePage([])])).toEqual([]);
  });
});

describe('getNextAdminNotesPage', () => {
  it('còn ghi chú chưa tải ⇒ trang kế tiếp', () => {
    expect(getNextAdminNotesPage(makeNotePage([], { page: 1, limit: 20, total: 21 }))).toBe(2);
    expect(getNextAdminNotesPage(makeNotePage([], { page: 2, limit: 20, total: 41 }))).toBe(3);
  });

  it('đã phủ hết (kể cả đúng bằng page × limit) hoặc không có ghi chú ⇒ không còn trang', () => {
    expect(
      getNextAdminNotesPage(makeNotePage([], { page: 1, limit: 20, total: 20 })),
    ).toBeUndefined();
    expect(
      getNextAdminNotesPage(makeNotePage([], { page: 2, limit: 20, total: 40 })),
    ).toBeUndefined();
    expect(
      getNextAdminNotesPage(makeNotePage([], { page: 1, limit: 20, total: 0 })),
    ).toBeUndefined();
  });

  it('kích thước trang dùng ở FE nằm trong trần của BE (50)', () => {
    expect(ADMIN_NOTES_PAGE_SIZE).toBeGreaterThan(0);
    expect(ADMIN_NOTES_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});
