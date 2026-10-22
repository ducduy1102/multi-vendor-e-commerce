// Hằng số class dùng chung giữa component thật và skeleton để hai bên không lệch nhau (rules/frontend.md mục 10).

// Một dòng thông báo: icon | chữ | giờ + chấm chưa đọc. Cột giữa `minmax(0,1fr)` (KHÔNG `1fr` trần): lưới trần lấy
// min-content của phần tử con nên một chuỗi dài không dấu cách (tên shop/lý do do người dùng nhập) sẽ làm cả cột — rồi cả
// trang — rộng bằng chuỗi (rules/frontend.md mục 5; đã đo ở /checkout 4425px).
export const NOTIFICATION_ROW_CLASS =
  'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left';

export const NOTIFICATION_ICON_WRAPPER_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary';

// Skeleton chỉ mang tính trang trí: tôn trọng prefers-reduced-motion.
export const SKELETON_CLASS = 'motion-reduce:animate-none';

// Khung danh sách: viền + nền thẻ, các dòng ngăn bằng đường kẻ.
export const NOTIFICATION_LIST_FRAME_CLASS =
  'overflow-hidden rounded-xl border border-border bg-card text-card-foreground';
