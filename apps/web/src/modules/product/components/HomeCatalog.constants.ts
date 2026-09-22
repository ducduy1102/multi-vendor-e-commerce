// Dùng chung giữa HomeCatalog (lưới thật) và ProductGridSkeleton (lưới
// skeleton)
export const HOME_PRODUCTS_LIMIT = 8;
// Lưới riêng cho trang chủ (HomeCatalog.tsx/HomeCatalogSkeleton.tsx) — đặt
// tên gắn với "catalog" (không chỉ "product") vì /products giờ có lưới
// RIÊNG của nó (PRODUCTS_PAGE_GRID_CLASS bên dưới, số cột khác do có sidebar
// filter chiếm chỗ) — 2 hằng số không dùng thay cho nhau được.
export const HOME_CATALOG_GRID_CLASS =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

// Lưới của /products (ProductListResults.tsx, dùng chung với fallback
// Suspense qua ProductGridSkeleton). Dừng ở 3 cột từ `sm` tới hết `lg`
// (không khai riêng `lg:grid-cols-3` — thừa, giống hệt giá trị `sm:` đã áp
// dụng, không đổi gì) vì có sidebar filter (`lg:w-64`) chiếm chỗ ngang, chỉ
// lên 4 cột ở `xl` khi đủ rộng — không cần khớp số cột HOME_CATALOG_GRID_CLASS
// (trang chủ không có sidebar nên rộng hơn).
export const PRODUCTS_PAGE_GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4';

// Dùng chung giữa CategoryShortcutList (lưới thật) và HomeCatalogSkeleton
// (lưới skeleton) — cùng lý do trên. auto-fill + cột rộng CỐ ĐỊNH (không
// 1fr/minmax) + justify-start: vài category không bị kéo giãn lấp đầy hàng.
export const CATEGORY_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fill,5.5rem)] justify-start gap-x-2 gap-y-4';
// Không có limit thật cho category (getCategories() trả hết, không phân
// trang) — số ô skeleton chỉ là ước lượng hợp lý để không trống trải lúc
// tải, không cần khớp chính xác số category thật trong DB.
export const CATEGORY_SKELETON_COUNT = 4;
