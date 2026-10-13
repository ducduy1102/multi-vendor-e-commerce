// Kiểm tra chuỗi người dùng nhập TRƯỚC khi vào DB/email (Week9.md 5.2). File nội bộ của package (không export
// ra index, cùng precedent `optional-text.ts`): schema ở auth/shop dùng, FE không gọi trực tiếp.
//
// Đây là lớp phòng thủ NÔNG, không thay cho mã hoá đầu ra: React tự escape khi render, mọi email giao dịch
// phải qua `escapeHtml` (note-nestjs.md AY). Lớp này chặn những thứ mã hoá đầu ra KHÔNG cứu được:
//   - NUL (\u0000): JSON hợp lệ nhưng Postgres từ chối ghi vào cột text ⇒ 500 thay vì 400.
//   - Ký tự điều khiển khác / dấu phân dòng Unicode: phá log, header, nội dung email dạng text.
//   - Ký tự bidi-override (U+202A–202E, U+2066–2069) và BOM: dùng để giả mạo thứ tự chữ hiển thị
//     ("Trojan Source") trong tên hiển thị cho Admin/người bán thấy.
//   - `<` `>` trong TÊN (người, shop): không có tên thật nào cần chúng, và chặn từ đầu giúp mọi nơi lỡ quên
//     escape (log, CSV xuất báo cáo sau này, email dạng text) vẫn không mang được thẻ HTML.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
// Cho phép \t (09), \n (0A), \r (0D) — dùng cho văn bản nhiều dòng (mô tả shop...).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
// Bidi override/isolate, BOM/zero-width no-break space, dấu phân dòng/đoạn Unicode.
const SPOOFING_CHARS = /[\u202a-\u202e\u2066-\u2069\ufeff\u2028\u2029]/;
const HTML_ANGLE_BRACKETS = /[<>]/;

// Tên hiển thị 1 dòng (tên người, tên shop).
export function isSafeName(value: string): boolean {
  return (
    !CONTROL_CHARS.test(value) && !SPOOFING_CHARS.test(value) && !HTML_ANGLE_BRACKETS.test(value)
  );
}

// Văn bản nhiều dòng (mô tả) — cho phép xuống dòng/tab, vẫn chặn NUL, điều khiển khác và ký tự giả mạo.
// Không chặn `<` `>`: câu như "size < 5kg" hợp lệ, và React/email đã escape khi hiển thị.
export function isSafeMultilineText(value: string): boolean {
  return !CONTROL_CHARS_EXCEPT_WHITESPACE.test(value) && !SPOOFING_CHARS.test(value);
}

// Số BYTE UTF-8 của chuỗi. bcrypt chỉ đọc 72 BYTE đầu chứ không phải 72 ký tự — mật khẩu có dấu tiếng Việt
// (3 byte/ký tự) hay emoji (4 byte) vượt 72 byte dù chưa tới 72 ký tự, phần đuôi bị bỏ im lặng ⇒ hai mật
// khẩu khác nhau ở đuôi băm ra cùng một giá trị. `lib` của package chỉ có ES2022 (không có TextEncoder) nên
// đếm tay theo code point.
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) as number;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
