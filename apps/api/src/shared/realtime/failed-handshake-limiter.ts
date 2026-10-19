import {
  REALTIME_FAILED_HANDSHAKE_MAX,
  REALTIME_FAILED_HANDSHAKE_MAX_TRACKED,
  REALTIME_FAILED_HANDSHAKE_WINDOW_MS,
} from './realtime.constants';

export interface FailedHandshakeLimiter {
  // Khoá (IP) đang bị chặn: đã thất bại ≥ ngưỡng trong cửa sổ hiện tại.
  isBlocked(key: string): boolean;
  // Ghi một lần thất bại. Trả true đúng lần làm khoá CHUYỂN sang bị chặn (để nơi gọi log một lần, không log
  // mỗi request bị chặn).
  recordFailure(key: string): boolean;
}

export interface FailedHandshakeLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  maxTrackedKeys?: number;
  // Tiêm đồng hồ để test không phải chờ thật.
  now?: () => number;
}

interface Entry {
  count: number;
  windowStart: number;
}

// Cửa sổ cố định theo khoá. Chặn hết tối đa `windowMs` kể từ lần thất bại đầu của cửa sổ — chặn là biện pháp
// giảm thiểu dò token/brute-force, không phải án phạt dài hạn.
//
// Trạng thái nằm TRONG BỘ NHỚ của một instance (đổi sang Redis ở Tuần 12 cùng adapter của Socket.io; Week10.md
// D9) nên: khởi động lại thì mất, nhiều instance thì mỗi instance đếm riêng. Chấp nhận được vì đây chỉ là lớp
// giảm thiểu — cổng xác thực mới là lớp bảo vệ chính. Giới hạn tin nhắn/hội thoại (Bước 4) cố ý dùng DB
// chứ không dùng bộ nhớ như thế này.
export function createFailedHandshakeLimiter(
  options: FailedHandshakeLimiterOptions = {},
): FailedHandshakeLimiter {
  const maxFailures = options.maxFailures ?? REALTIME_FAILED_HANDSHAKE_MAX;
  const windowMs = options.windowMs ?? REALTIME_FAILED_HANDSHAKE_WINDOW_MS;
  const maxTracked =
    options.maxTrackedKeys ?? REALTIME_FAILED_HANDSHAKE_MAX_TRACKED;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const isLive = (entry: Entry, at: number) =>
    at - entry.windowStart < windowMs;

  // Giữ bộ nhớ có trần: xoá các khoá đã hết cửa sổ; nếu vẫn đầy (toàn khoá còn sống) thì bỏ khoá cũ nhất theo
  // thứ tự chèn của Map.
  const makeRoom = (at: number) => {
    if (entries.size < maxTracked) return;
    for (const [key, entry] of entries) {
      if (!isLive(entry, at)) entries.delete(key);
    }
    while (entries.size >= maxTracked) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  };

  return {
    isBlocked(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      return isLive(entry, now()) && entry.count >= maxFailures;
    },
    recordFailure(key) {
      const at = now();
      const entry = entries.get(key);
      if (entry && isLive(entry, at)) {
        entry.count += 1;
        return entry.count === maxFailures;
      }
      // Cửa sổ mới (khoá chưa có hoặc đã hết hạn). Xoá rồi chèn lại để khoá mới nằm cuối thứ tự chèn.
      entries.delete(key);
      makeRoom(at);
      entries.set(key, { count: 1, windowStart: at });
      return maxFailures === 1;
    },
  };
}
