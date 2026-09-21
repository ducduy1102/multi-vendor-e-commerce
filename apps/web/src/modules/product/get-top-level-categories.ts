import type { Category } from './types';

// Dùng chung cho page.tsx (quyết định ẩn/hiện cả section "Danh mục nổi
// bật") và CategoryShortcutList (nội dung hiển thị) — tính 1 lần ở
// page.tsx, CategoryShortcutList chỉ nhận mảng đã lọc sẵn qua prop, không
// tự lọc lại lần 2. Category cấp cha (parentId === null) — shortcut trang
// chủ chỉ cần điều hướng nhanh tới nhóm ngành hàng lớn, không cần lồng cả
// cây phân cấp (category con chọn ở trang danh sách, /products).
export function getTopLevelCategories(categories: Category[]): Category[] {
  return categories.filter((category) => category.parentId === null);
}
