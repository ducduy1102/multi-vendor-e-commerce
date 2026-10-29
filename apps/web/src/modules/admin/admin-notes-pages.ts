import type { AdminNote, AdminNoteListResponse } from './types';

// Số ghi chú mỗi lần tải. BE cho tối đa 50; 20 đủ cho gần như mọi đối tượng chỉ trong một trang.
export const ADMIN_NOTES_PAGE_SIZE = 20;

// Gộp các trang đã tải của một danh sách ghi chú (mới nhất trước) thành một mảng, KHỬ TRÙNG theo id. Phân trang theo offset trên
// danh sách mà ghi chú mới luôn chen vào ĐẦU: nếu có người thêm ghi chú giữa hai lần tải trang, ghi chú cuối của trang trước
// bị đẩy sang đầu trang sau và xuất hiện hai lần. Giữ lần xuất hiện ĐẦU TIÊN để thứ tự không đổi.
export function flattenAdminNotePages(pages: readonly AdminNoteListResponse[]): AdminNote[] {
  const seen = new Set<string>();
  const notes: AdminNote[] = [];
  for (const page of pages) {
    for (const note of page.items) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      notes.push(note);
    }
  }
  return notes;
}

// Trang kế tiếp (nếu còn) cho `useInfiniteQuery`: còn ghi chú chưa tải khi các trang đã lấy chưa phủ hết `total`. Tính theo
// `page * limit` của chính trang cuối thay vì đếm số dòng đã gộp để việc khử trùng ở trên không làm lệch số trang.
export function getNextAdminNotesPage(lastPage: AdminNoteListResponse): number | undefined {
  return lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined;
}
