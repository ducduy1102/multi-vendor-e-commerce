// Id (người dùng, shop, sản phẩm, kháng nghị...) luôn là UUID. Kiểm dạng TRƯỚC khi chạm DB để mọi id sai (kể cả có ký tự NUL mà Postgres
// không nhận và sẽ thành 500) ra cùng một 404 như id không tồn tại — không có "oracle" phân biệt id sai dạng với id không có thật.
// Ban đầu nằm ở modules/admin (`admin-user-id.ts`); chuyển vào `shared/` khi module `appeal` cần dùng lại cho id sản phẩm trên đường
// dẫn (rules/general.md mục 1: code dùng chung ≥ 2 module mới đưa vào shared/).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
