import { isUuid } from '../../shared/utils/is-uuid';

// Id người dùng và id shop luôn là UUID. Kiểm dạng TRƯỚC khi chạm DB để mọi id sai (kể cả có ký tự NUL mà Postgres không nhận và sẽ
// thành 500) ra cùng một 404 `USER_NOT_FOUND` như id không tồn tại — không có "oracle" phân biệt id sai dạng với id không có
// thật. Dùng ở MỌI route nhận `:id` người dùng của Admin (chi tiết, khoá, mở lại). `isUuid` nay nằm ở `shared/utils/is-uuid.ts`
// (module `appeal` cũng dùng); re-export ở đây để các service admin giữ nguyên import.
export { isUuid };

export function isUserId(value: string): boolean {
  return isUuid(value);
}
