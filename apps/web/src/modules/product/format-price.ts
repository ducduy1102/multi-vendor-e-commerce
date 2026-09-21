// Dùng chung cho ProductPreviewCard và SellerProductsContainer (trước đó
// định nghĩa trùng lặp y hệt ở cả 2 nơi, vi phạm rules/general.md mục 1 —
// code dùng chung ≥2 nơi trong cùng module phải tách ra 1 chỗ).
//
// Locale cố định 'vi-VN' cho MỌI locale hiển thị (vi lẫn en) — chủ đích,
// đã chốt ở rules/frontend.md mục "UI polish" 6: VND vẫn giữ nguyên cách
// đọc số quen thuộc (dấu chấm ngăn cách hàng nghìn) dù site đang ở tiếng
// Anh, giống nhiều sàn quốc tế giữ nguyên format tiền tệ bản địa. Không
// đổi theo locale hiện tại của next-intl.
export function formatPrice(value: string): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(Number(value));
}
