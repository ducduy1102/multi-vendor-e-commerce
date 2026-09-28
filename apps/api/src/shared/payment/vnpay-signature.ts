import { createHmac, timingSafeEqual } from 'crypto';

// Hàm thuần cho chữ ký VNPay API 2.1.0 (tài liệu sandbox chính thức: HMAC-SHA512 trên các tham số
// sắp theo tên tăng dần, mã hoá URL, nối bằng `&`). Tách riêng để test bằng vector cố định.

// Mã hoá URL giống `urlencode` của PHP trong tài liệu VNPay: khoảng trắng → `+`, và `! ' ( ) * ~`
// cũng bị mã hoá (encodeURIComponent để nguyên các ký tự này). Khác biệt này lệch chữ ký khi giá trị
// chứa chúng — lỗi kinh điển gây "sai chữ ký" (RspCode 97).
export function vnpEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(
      /[!'()*~]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

// Chuỗi dữ liệu để ký: các cặp `key=value` (đã mã hoá) sắp theo TÊN tăng dần, nối bằng `&`.
// Chính chuỗi này cũng là query string của URL thanh toán (đã mã hoá sẵn).
export function buildSignData(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${vnpEncode(key)}=${vnpEncode(params[key])}`)
    .join('&');
}

export function signVnpay(signData: string, hashSecret: string): string {
  return createHmac('sha512', hashSecret)
    .update(signData, 'utf8')
    .digest('hex');
}

// So khớp chữ ký bằng timingSafeEqual. `timingSafeEqual` NÉM RangeError khi 2 buffer khác độ dài —
// chữ ký giả dài/ngắn bất thường sẽ làm endpoint IPN trả 500 thay vì "sai chữ ký", nên kiểm độ dài trước.
export function isSignatureEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual.toLowerCase(), 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// `yyyyMMddHHmmss` theo GMT+7. Tính từ mốc UTC bằng offset CỐ ĐỊNH, không dựa múi giờ máy chủ
// (máy chủ/CI Windows-Linux khác múi giờ sẽ lệch giờ hết hạn).
export function formatVnpDate(date: Date): string {
  const d = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}
