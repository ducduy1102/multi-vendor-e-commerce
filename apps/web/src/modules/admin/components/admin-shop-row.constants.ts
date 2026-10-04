// Dùng chung giữa bảng shop thật (AdminShopRow + AdminShopListHeader) và AdminShopListSkeleton để 2
// bên không lệch kích thước/cột khi dữ liệu về (rules/frontend.md mục 10 — chung hằng số class giữa
// bản thật và skeleton).

// 1 template cột duy nhất cho cả dòng tiêu đề lẫn từng dòng dữ liệu (rules/frontend.md mục 5): từ
// `md` là bảng 5 cột (shop | chủ shop | ngày tạo | trạng thái | thao tác), dưới `md` mỗi dòng là 1 thẻ
// xếp dọc — mỗi trường tự có nhãn (hiện ở mobile, `md:sr-only` ở desktop để vẫn có trong cây trợ năng).
// Cột cuối PHẢI có độ rộng cố định (không `auto`): dòng tiêu đề và các dòng dữ liệu là những grid riêng,
// `auto` co theo nội dung từng grid (chữ "Thao tác" ngắn hơn cụm nút) nên các cột `fr` còn lại chia khác
// nhau và tiêu đề lệch khỏi dữ liệu.
export const ADMIN_SHOP_GRID_CLASS =
  'grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_7rem_minmax(0,1.5fr)_11rem] md:items-center';

export const ADMIN_SHOP_TABLE_CLASS =
  'overflow-hidden rounded-lg border border-border bg-background';

export const ADMIN_SHOP_ROW_CLASS = 'px-3 py-3 sm:px-4';

export const ADMIN_SHOP_HEADER_CLASS =
  'hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4 md:grid';

// Nhãn của từng trường trong dòng: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop.
export const ADMIN_SHOP_FIELD_LABEL_CLASS = 'text-xs text-muted-foreground md:sr-only';

export const ADMIN_SHOP_LOGO_CLASS = 'size-10 shrink-0 rounded-md';
