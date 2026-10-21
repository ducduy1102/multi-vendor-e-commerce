// Sổ đăng ký các việc "dọn dữ liệu riêng tư của người dùng trước" khi NGƯỜI DÙNG ĐANG ĐĂNG NHẬP ĐỔI NGƯỜI hoặc ĐĂNG XUẤT.
//
// Vì sao cần: `SessionCacheReset` (layout) xoá QueryClient nhưng không với tới các store Zustand giữ dữ liệu riêng tư —
// ví dụ HỘP CHỜ GỬI của chat (tin "gửi lỗi" kèm nội dung người dùng đã gõ), nếu còn lại thì người đăng nhập kế tiếp trên
// cùng tab thấy tin của người trước (đã đo bằng trình duyệt thật). Layout lại KHÔNG được import mã chat (khách vãng lai
// không được tải nó, xem shared/lib/guest-bundle.test.ts) và module chat không biết đăng xuất (module lá), nên chiều phụ
// thuộc được đảo ngược: store chat TỰ ĐĂNG KÝ hàm dọn của nó vào sổ này ngay khi mã chat được nạp, còn SessionCacheReset
// chỉ gọi `runSessionResets()`. Hệ quả mong muốn: có hộp chờ ⇒ chắc chắn mã chat đã nạp ⇒ chắc chắn đã đăng ký; chưa
// nạp mã chat thì không có gì để dọn. Việc dọn KHÔNG phụ thuộc vào một component nạp động nào mount kịp hay không (một
// phiên bản trước làm vậy và rò rỉ khi chunk chưa về lúc mạng chập chờn).
type SessionResetter = () => void;

const resetters = new Set<SessionResetter>();

// Trả về hàm huỷ đăng ký (dùng cho test).
export function registerSessionReset(resetter: SessionResetter): () => void {
  resetters.add(resetter);
  return () => {
    resetters.delete(resetter);
  };
}

// Chạy MỌI bộ dọn. Một bộ lỗi không được chặn các bộ còn lại (đây là việc quyền riêng tư: dọn được bao nhiêu hay bấy
// nhiêu), nhưng lỗi vẫn được báo ra ngoài luồng render thay vì bị nuốt.
export function runSessionResets(): void {
  for (const resetter of [...resetters]) {
    try {
      resetter();
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}
