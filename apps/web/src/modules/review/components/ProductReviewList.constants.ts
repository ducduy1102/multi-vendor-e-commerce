// Dùng chung giữa ProductReviewList (khối thật) và ReviewListSkeleton — đúng rules/frontend.md mục 10 (skeleton
// phải khớp kích thước/bố cục nội dung thật), tránh 2 bên khai riêng rồi lệch nhau. `id="reviews"` ở cả hai để
// neo `#reviews` (bấm lọc/chuyển trang) vẫn trỏ đúng khi khối còn đang là skeleton.
//
// `scroll-mt-28` (112px) chừa chỗ cho header dính: cao 57px ở desktop và 97px ở mobile (logo + ô tìm kiếm 2
// hàng). Với `scroll-mt-4` ban đầu, trình duyệt cuộn tiêu đề tới cách đỉnh 16px nên bị header che hết — chỉ lộ
// ra khi đo bằng trình duyệt thật ở trang đủ dài để cuộn tới neo (jsdom không có layout).
export const REVIEW_SECTION_CLASS = 'mt-10 flex scroll-mt-28 flex-col gap-4';

// Lưới tóm tắt: cột điểm cố định bên trái, thanh phân bố chiếm phần còn lại. `grid-cols-1` ở mobile và
// `minmax(0,1fr)` ở sm+ (không dùng `1fr` trần) để chuỗi dài không dấu cách không đẩy cột rộng ra
// (rules/frontend.md mục 5).
export const REVIEW_SUMMARY_GRID_CLASS =
  'grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]';

// Số dòng đánh giá giả hiển thị khi đang tải (ước lượng — chưa biết số đánh giá thật của trang).
export const REVIEW_SKELETON_ITEMS = 3;
