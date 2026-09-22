// Dùng chung giữa HomeCatalog (lưới thật) và ProductGridSkeleton (lưới
// skeleton) — 1 nguồn duy nhất, tránh 2 bên lệch nhau nếu chỉ sửa 1 chỗ.
export const HOME_PRODUCTS_LIMIT = 8;
// xl:grid-cols-5 (UI polish đợt 2 mục 7) — đã kiểm tra bằng mockup Playwright
// riêng (không commit) ở 1280px: tên sản phẩm tiếng Việt dài vẫn đọc tốt ở
// ~237px/thẻ (line-clamp-2), không cần rút gọn thêm.
export const HOME_PRODUCT_GRID_CLASS =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

// Dùng chung giữa CategoryShortcutList (lưới thật) và HomeCatalogSkeleton
// (lưới skeleton) — cùng lý do trên. auto-fill + cột rộng CỐ ĐỊNH (không
// 1fr/minmax) + justify-start: vài category không bị kéo giãn lấp đầy hàng.
export const CATEGORY_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fill,5.5rem)] justify-start gap-x-2 gap-y-4';
// Không có limit thật cho category (getCategories() trả hết, không phân
// trang) — số ô skeleton chỉ là ước lượng hợp lý để không trống trải lúc
// tải, không cần khớp chính xác số category thật trong DB.
export const CATEGORY_SKELETON_COUNT = 4;
