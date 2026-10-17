// Đổi giá trị ENV `TRUST_PROXY` thành tham số của `app.set('trust proxy', ...)` (Express). Sau reverse
// proxy của nền tảng deploy, `req.ip` mặc định là IP của proxy chứ không phải của khách.
//   - không khai / để trống (`VAR=` ⇒ chuỗi rỗng — rules/general.md mục 4) / 'false' / '0' / giá trị lạ
//     ⇒ false: tắt, `req.ip` là địa chỉ socket. Giá trị lạ KHÔNG ném lỗi (sai cấu hình không được làm
//     sập app); false là hướng an toàn vì header `X-Forwarded-For` do client gửi không bị tin.
//   - số nguyên dương N ⇒ tin N chặng proxy cuối (1 = đúng một reverse proxy của nền tảng): nên dùng.
//   - 'true' ⇒ tin MỌI chặng, client giả được IP bằng cách tự thêm `X-Forwarded-For` — chỉ dùng khi API
//     không nhận được lưu lượng nào ngoài proxy của nền tảng.
export function parseTrustProxy(raw: string | undefined): boolean | number {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  if (value === 'true') return true;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  return false;
}
