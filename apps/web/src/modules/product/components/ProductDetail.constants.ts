// Dùng chung giữa ProductDetailContainer (bố cục thật) và
// ProductDetailSkeleton (bố cục skeleton) — đúng rules/frontend.md mục 10
// (skeleton phải khớp kích thước/bố cục nội dung thật), tránh 2 bên khai
// riêng rồi lệch nhau theo thời gian.
export const PRODUCT_DETAIL_LAYOUT_CLASS = 'grid grid-cols-1 gap-6 lg:grid-cols-[28rem_1fr]';

// Số thumbnail hiện cùng lúc trong gallery (phần còn lại cuộn/kéo ngang) —
// ProductGallery và ProductDetailSkeleton dùng chung để không lệch nhau.
export const GALLERY_THUMBNAILS_PER_VIEW = 5;
