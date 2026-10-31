// Dùng chung giữa hàng đợi báo cáo thật (AdminReportsContainer) và AdminReportListSkeleton để hai bên không lệch kích thước / cột khi dữ liệu
// về (rules/frontend.md mục 10). Cố ý KHÔNG dùng chung hằng với bảng kháng nghị / shop / người dùng (bài học 4.5: hằng số dùng chung làm đổi
// breakpoint ở bảng này kéo theo bảng kia).

// Từ `xl` (1280px, sidebar 224px đã trừ): danh sách 24rem + khung xem nhanh chiếm phần còn lại. Dưới `xl` chỉ có danh sách một cột (bấm dòng
// mở trang chi tiết). `minmax(0, …)` để chữ dài không đẩy rộng cột (rules/frontend.md mục 5).
export const ADMIN_REPORT_LAYOUT_CLASS =
  'grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]';

export const ADMIN_REPORT_LIST_CLASS =
  'overflow-hidden rounded-lg border border-border bg-background';

// Media query của `xl` — PHẢI khớp breakpoint `xl:` của Tailwind ở hai hằng trên (80rem).
export const ADMIN_REPORT_WIDE_QUERY = '(min-width: 80rem)';

// Trang chi tiết: nội dung bên trái, panel Xử lý 22rem bên phải từ `xl` (dính khi cuộn); dưới `xl` panel nằm dưới nội dung.
export const ADMIN_REPORT_DETAIL_LAYOUT_CLASS =
  'grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]';
