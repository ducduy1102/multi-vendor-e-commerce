// Dùng chung giữa các bảng thật (3 loại dòng + AdminRefundListHeader) và AdminRefundListSkeleton để các bên không
// lệch kích thước/cột khi dữ liệu về (rules/frontend.md mục 10).

// 1 template cột duy nhất cho cả dòng tiêu đề lẫn từng dòng dữ liệu của CẢ BA bảng (rules/frontend.md mục 5): từ `md`
// là bảng 4 cột (đối tượng | bối cảnh | trạng thái | thao tác), dưới `md` mỗi dòng là 1 thẻ xếp dọc — mỗi trường tự
// có nhãn (hiện ở mobile, `md:sr-only` ở desktop để vẫn có trong cây trợ năng). Ba bảng chỉ khác NHÃN cột nên dùng
// chung một lưới. `grid-cols-1` (= minmax(0, 1fr)) CHỦ ĐÍCH ở mobile: dòng chứa chữ do người dùng nhập (lý do,
// ghi chú, tên), không có nó cột ngầm định `auto` lấy min-content của chuỗi dài không dấu cách và làm cả trang
// rộng ra. Cột cuối PHẢI có độ rộng cố định (không `auto`): dòng tiêu đề và các dòng dữ liệu là những grid riêng,
// `auto` co theo nội dung từng grid nên các cột `fr` còn lại chia khác nhau và tiêu đề lệch khỏi dữ liệu.
export const ADMIN_REFUND_GRID_CLASS =
  'grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_11rem] md:items-start';

export const ADMIN_REFUND_TABLE_CLASS =
  'overflow-hidden rounded-lg border border-border bg-background';

export const ADMIN_REFUND_ROW_CLASS = 'px-3 py-3 sm:px-4';

export const ADMIN_REFUND_HEADER_CLASS =
  'hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4 md:grid';

// Nhãn của từng trường trong dòng: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop.
export const ADMIN_REFUND_FIELD_LABEL_CLASS = 'text-xs text-muted-foreground md:sr-only';

// Số ký tự đầu của mã (UUID) hiện trên dòng để Admin gọi tên/đối chiếu; đủ phân biệt trong một danh sách.
export const ADMIN_REFUND_SHORT_CODE_LENGTH = 8;
