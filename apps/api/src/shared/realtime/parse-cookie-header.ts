// Đọc header `Cookie` của request (handshake WebSocket không đi qua `cookie-parser` của Express). Tự viết thay
// vì thêm dependency `cookie` (Week10.md 3.2: không dependency mới ngoài 3 gói đã duyệt).
//
// Quy tắc:
//   - các cặp cách nhau bởi `;`, tên/giá trị cắt khoảng trắng hai đầu;
//   - cặp không có `=` hoặc tên rỗng ⇒ bỏ qua;
//   - TRÙNG TÊN ⇒ lấy giá trị ĐẦU TIÊN, đúng như `cookie`/`cookie-parser` mà đường REST đang dùng — cùng một
//     header phải cho cùng một token ở cả hai đường (nếu lệch, cùng một cookie có thể được REST chấp nhận
//     nhưng socket từ chối hoặc ngược lại);
//   - giá trị bọc trong dấu nháy kép thì bỏ nháy (RFC 6265), rồi giải mã %-escape; giải mã lỗi (`%E0%A4%A`) ⇒
//     giữ nguyên chuỗi gốc thay vì ném lỗi (đầu vào do client kiểm soát).
// Trả về `Map` (không phải object) để tên như `__proto__` hay `constructor` chỉ là khoá bình thường.
export function parseCookieHeader(
  header: string | undefined,
): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (!name || cookies.has(name)) continue;

    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    cookies.set(name, safeDecode(value));
  }
  return cookies;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
