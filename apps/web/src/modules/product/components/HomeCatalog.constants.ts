// Dùng chung giữa HomeCatalog (lưới thật) và ProductGridSkeleton (lưới
// skeleton) — 1 nguồn duy nhất, tránh 2 bên lệch nhau nếu chỉ sửa 1 chỗ.
export const HOME_PRODUCTS_LIMIT = 8;
export const HOME_PRODUCT_GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4';
