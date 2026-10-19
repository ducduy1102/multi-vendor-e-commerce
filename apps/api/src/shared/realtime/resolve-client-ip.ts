// IP khách của một kết nối, theo ĐÚNG ngữ nghĩa `trust proxy` của Express (cùng giá trị ENV `TRUST_PROXY`,
// xem parse-trust-proxy.ts) — handshake socket.io không đi qua Express nên `req.ip` không có sẵn.
//
// Danh sách ứng viên, gần server nhất trước: [địa chỉ socket, X-Forwarded-For từ phải sang trái...].
//   - false  ⇒ địa chỉ socket (header X-Forwarded-For do client gửi KHÔNG được tin);
//   - số N   ⇒ tin N chặng proxy gần nhất: lấy phần tử thứ N (đếm từ 0 ở địa chỉ socket), nếu chuỗi ngắn hơn thì
//              lấy phần tử xa nhất;
//   - true   ⇒ tin mọi chặng ⇒ phần tử xa nhất (ngoài cùng bên trái của header).
//
// Vì sao quan trọng: nếu cấu hình sai (vd sau Cloudflare + Render mà chỉ tin 1 chặng) thì mọi người dùng cùng
// "một IP" của proxy, và bộ giới hạn handshake thất bại sẽ chặn cả nhóm vì lỗi của một người.
const MAX_IP_LENGTH = 64;
const UNKNOWN_IP = 'unknown';

export function resolveClientIp(
  forwardedFor: string | undefined,
  remoteAddress: string | undefined,
  trustProxy: boolean | number,
): string {
  const forwarded = (forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reverse();
  const candidates = [remoteAddress?.trim() ?? '', ...forwarded];

  let picked: string | undefined;
  if (trustProxy === false) {
    picked = candidates[0];
  } else if (trustProxy === true) {
    picked = candidates[candidates.length - 1];
  } else {
    picked = candidates[Math.min(trustProxy, candidates.length - 1)];
  }
  return normalizeIp(picked);
}

// `::ffff:1.2.3.4` (IPv4 viết dạng IPv6) và `1.2.3.4` là cùng một máy ⇒ cùng một khoá. Cắt độ dài vì phần tử
// ngoài các chặng tin cậy do client tự khai.
function normalizeIp(value: string | undefined): string {
  const trimmed = value?.trim().slice(0, MAX_IP_LENGTH) ?? '';
  if (!trimmed) return UNKNOWN_IP;
  return trimmed.replace(/^::ffff:/i, '');
}
