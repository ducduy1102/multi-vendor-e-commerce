import {
  ADMIN_SHOP_HEADER_CLASS,
  ADMIN_SHOP_ROW_CLASS,
  ADMIN_SHOP_TABLE_CLASS,
} from './admin-shop-row.constants';

// Dùng chung giữa bảng người dùng thật (AdminUserRow + AdminUserListHeader) và AdminUserListSkeleton để hai bên không lệch
// kích thước/cột khi dữ liệu về (rules/frontend.md mục 10). Khung bảng, padding dòng và dòng tiêu đề lấy lại của bảng shop
// để hai màn Admin cùng một dáng.

// MỘT template cột cho cả dòng tiêu đề lẫn từng dòng dữ liệu (rules/frontend.md mục 5): từ `md` là bảng 4 cột
// (người dùng | trạng thái | thời điểm | thao tác), dưới `md` mỗi dòng là một thẻ xếp dọc. Cột cuối PHẢI có độ rộng cố
// định (không `auto`): tiêu đề và các dòng là những grid riêng, `auto` co theo nội dung từng grid nên các cột `fr` còn lại
// chia khác nhau và tiêu đề lệch khỏi dữ liệu.
export const ADMIN_USER_GRID_CLASS =
  'grid gap-x-4 gap-y-2 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_8rem_11rem] md:items-center';

export const ADMIN_USER_TABLE_CLASS = ADMIN_SHOP_TABLE_CLASS;
export const ADMIN_USER_ROW_CLASS = ADMIN_SHOP_ROW_CLASS;
export const ADMIN_USER_HEADER_CLASS = ADMIN_SHOP_HEADER_CLASS;

// Nhãn trường chỉ cho trình đọc màn hình: huy hiệu trạng thái và chú thích ("Tham gia", "Khoá lúc") đã tự nói rõ, thêm nhãn
// nhìn thấy chỉ làm thẻ mobile dài ra.
export const ADMIN_USER_FIELD_LABEL_CLASS = 'sr-only';

// Mục tiêu bấm tối thiểu cho link tên trong dòng và các link lọc: vòng focus rõ ràng, không tự thêm padding làm lệch cột.
export const ADMIN_USER_LINK_FOCUS_CLASS =
  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
