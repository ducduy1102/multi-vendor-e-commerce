// Dùng chung giữa bảng shop thật (AdminShopRow + AdminShopListHeader) và AdminShopListSkeleton để 2
// bên không lệch kích thước/cột khi dữ liệu về (rules/frontend.md mục 10 — chung hằng số class giữa
// bản thật và skeleton).

// 1 template cột duy nhất cho cả dòng tiêu đề lẫn từng dòng dữ liệu (rules/frontend.md mục 5): từ
// `lg` là bảng 5 cột (shop | chủ shop | ngày tạo | trạng thái | thao tác), dưới `lg` mỗi dòng là 1 thẻ
// xếp dọc — mỗi trường tự có nhãn (hiện ở mobile, `lg:sr-only` ở desktop để vẫn có trong cây trợ năng).
// Cột cuối PHẢI có độ rộng cố định (không `auto`): dòng tiêu đề và các dòng dữ liệu là những grid riêng,
// `auto` co theo nội dung từng grid (chữ "Thao tác" ngắn hơn cụm nút) nên các cột `fr` còn lại chia khác
// nhau và tiêu đề lệch khỏi dữ liệu.
export const ADMIN_SHOP_GRID_CLASS =
  'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_7rem_minmax(0,1.5fr)_11rem] lg:items-center';

export const ADMIN_SHOP_TABLE_CLASS =
  'overflow-hidden rounded-lg border border-border bg-background';

export const ADMIN_SHOP_ROW_CLASS = 'px-3 py-3 sm:px-4';

// Thẻ (dưới `lg`) xếp 2 cột — Chủ shop cạnh Ngày, còn lại chiếm cả hàng — để thẻ không cao 260px chỉ vì mỗi trường một khối
// (Week11.md 4.5). Cột trái rộng hơn (1,6fr) vì email chủ shop dài. Từ `lg` là bảng 5 cột nên mỗi ô chỉ một cột.
export const ADMIN_SHOP_FULL_ROW_CELL_CLASS = 'col-span-2 lg:col-span-1';

export const ADMIN_SHOP_HEADER_CLASS =
  'hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4 lg:grid';

// Nhãn của từng trường trong dòng: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop.
export const ADMIN_SHOP_FIELD_LABEL_CLASS = 'text-xs text-muted-foreground lg:sr-only';

export const ADMIN_SHOP_LOGO_CLASS = 'size-10 shrink-0 rounded-md';

// Cột Thao tác (Week11.md 4.5), hai kiểu chọn theo SỐ NÚT (`shouldStackShopActions`, admin-shop-actions.ts):
// - xếp dọc (3 nút trở lên): từ `lg` mọi nút rộng đủ cột 11rem — cùng cách cột thao tác của bảng hoàn tiền (ADMIN_REFUND_*,
//   AdminRefundRequestRow) — để mép nút thẳng và cỡ nút không đổi theo độ dài chữ;
// - một hàng gọn căn phải (1–2 nút): hàng bảng giữ chiều thấp, mép phải thẳng với tiêu đề "Thao tác".
// Dưới `lg` (thẻ) cả hai kiểu đều để nút cùng hàng và tự xuống dòng. Dùng chung với skeleton.
export const ADMIN_SHOP_ACTIONS_STACKED_CLASS =
  'flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch';
export const ADMIN_SHOP_ACTIONS_INLINE_CLASS = 'flex flex-wrap items-center gap-2 lg:justify-end';

// Chiều cao tối thiểu của mọi nút trong cột Thao tác (36px, như nút của bảng hoàn tiền) — cũng là vùng bấm đủ lớn trên mobile.
export const ADMIN_SHOP_ACTION_BUTTON_CLASS = 'min-h-9';
