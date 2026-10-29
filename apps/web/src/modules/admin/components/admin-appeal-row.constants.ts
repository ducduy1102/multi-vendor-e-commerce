// Dùng chung giữa bảng kháng nghị thật (AdminAppealRow + AdminAppealListHeader) và AdminAppealListSkeleton để hai bên không lệch
// kích thước/cột khi dữ liệu về (rules/frontend.md mục 10). Cố ý KHÔNG dùng chung hằng với bảng shop/người dùng: bài học 4.5 là
// một hằng số dùng chung làm đổi breakpoint ở bảng này kéo theo bảng kia.

// Một template cột duy nhất cho cả dòng tiêu đề lẫn từng dòng dữ liệu (rules/frontend.md mục 5): từ `lg` là bảng 5 cột (shop |
// lời kháng nghị | gửi lúc | trạng thái | thao tác), dưới `lg` mỗi dòng là một thẻ xếp dọc — mỗi trường tự có nhãn (hiện ở mobile,
// `lg:sr-only` ở desktop để vẫn có trong cây trợ năng). Cột lời kháng nghị rộng nhất (3fr) vì đó là nội dung Admin phải đọc. Cột cuối
// PHẢI có độ rộng cố định (không `auto`): dòng tiêu đề và các dòng dữ liệu là những grid riêng, `auto` co theo nội dung từng grid
// nên các cột `fr` còn lại chia khác nhau và tiêu đề lệch khỏi dữ liệu.
export const ADMIN_APPEAL_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_7rem_minmax(0,1.5fr)_11rem] lg:items-center';

export const ADMIN_APPEAL_TABLE_CLASS =
  'overflow-hidden rounded-lg border border-border bg-background';

export const ADMIN_APPEAL_ROW_CLASS = 'px-3 py-3 sm:px-4';

// Ô chiếm cả hàng của thẻ (dưới `lg`); từ `lg` là bảng nên mỗi ô chỉ một cột.
export const ADMIN_APPEAL_FULL_ROW_CELL_CLASS = 'col-span-2 lg:col-span-1';

export const ADMIN_APPEAL_HEADER_CLASS =
  'hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4 lg:grid';

// Nhãn của từng trường trong dòng: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop.
export const ADMIN_APPEAL_FIELD_LABEL_CLASS = 'text-xs text-muted-foreground lg:sr-only';

// Cột Thao tác: hai nút xếp dọc, rộng đủ cột 11rem để mép nút thẳng và cỡ nút không đổi theo độ dài chữ ("Chấp nhận" + "Từ chối"
// ngang hàng sẽ vượt 11rem). Dưới `lg` (thẻ) hai nút cùng hàng và tự xuống dòng. Dùng chung với skeleton.
export const ADMIN_APPEAL_ACTIONS_CLASS =
  'flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch';

// Chiều cao tối thiểu của mọi nút trong cột Thao tác (36px) — cũng là vùng bấm đủ lớn trên mobile.
export const ADMIN_APPEAL_ACTION_BUTTON_CLASS = 'min-h-9';
