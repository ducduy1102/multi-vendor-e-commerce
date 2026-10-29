import { z } from 'zod';

// Địa chỉ liên hệ hỗ trợ hiện trong email khoá tài khoản / shop (Week11.md D15). ENV TUỲ CHỌN: không đặt (hoặc đặt rỗng,
// hoặc đặt sai) ⇒ trả null và email không có dòng "Liên hệ hỗ trợ" nào — không bao giờ ném, một ENV sai không được làm hỏng
// việc khoá tài khoản. Đọc bằng `|| ` chứ không `??`: `.env` khai `SUPPORT_EMAIL=` cho ra chuỗi rỗng, không phải undefined
// (rules/general.md mục 4). Đọc MỖI LẦN gọi (không cache ở mức module) để test đổi ENV được và đổi cấu hình không cần
// khởi động lại logic.
const emailSchema = z.string().max(254).email();

export function getSupportEmail(): string | null {
  const raw = process.env.SUPPORT_EMAIL?.trim() || undefined;
  if (raw === undefined) return null;
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
