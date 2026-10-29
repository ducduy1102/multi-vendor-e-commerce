import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Key i18n (đầy đủ namespace) của lỗi đăng nhập có MÃ nghiệp vụ, hoặc null nếu lỗi không có mã đã biết. Trường hợp chính:
// tài khoản đang bị khoá / cấm / đã tự xoá ⇒ BE trả 401 `ACCOUNT_NOT_ACTIVE` (message cũng chỉ là chính mã đó) — chỉ dịch
// `message` thì người dùng thấy nguyên chữ "ACCOUNT_NOT_ACTIVE". Lỗi sai email/mật khẩu không có mã nên rơi về nhánh dịch
// message như trước. Câu hiển thị cố ý chung ("tài khoản hiện không hoạt động, liên hệ hỗ trợ"): không phân biệt khoá hay
// cấm cho người đăng nhập, lý do chi tiết đã gửi qua email.
export function getLoginErrorMessageKey(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = getErrorCode(error);
  return code ? ERROR_CODE_MESSAGE_KEYS[code] : null;
}
