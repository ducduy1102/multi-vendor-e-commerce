// Id người dùng và id shop luôn là UUID. Kiểm dạng TRƯỚC khi chạm DB để mọi id sai (kể cả có ký tự NUL mà Postgres không nhận và sẽ
// thành 500) ra cùng một 404 `USER_NOT_FOUND` như id không tồn tại — không có "oracle" phân biệt id sai dạng với id không có
// thật. Dùng ở MỌI route nhận `:id` người dùng của Admin (chi tiết, khoá, mở lại).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isUserId(value: string): boolean {
  return isUuid(value);
}
