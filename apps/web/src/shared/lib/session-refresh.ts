// Gia hạn phiên đăng nhập khi access token hết hạn (Week10.md 2.1). access_token chỉ sống 15 phút còn
// refresh_token 7 ngày, nên phiên chỉ bền khi FE tự đổi cặp token mới mỗi khi gặp 401 — trước đó không nơi
// nào gọi `POST /auth/refresh` nên người dùng bị đá về /login sau đúng 15 phút.
//
// File này CHỈ điều phối (gộp nhiều lần gọi thành một, khoá giữa các tab, báo mất phiên); lệnh gọi mạng thật
// do api-client truyền vào (`callRefresh`) để không import vòng và để test được không cần fetch.

// refreshed    : BE đã cấp cặp token mới (cookie mới đã nằm trong trình duyệt).
// skipped      : tab khác vừa gia hạn xong (xem RECENT_REFRESH_WINDOW_MS) — cookie đã mới, chỉ cần thử lại request.
// rejected     : BE từ chối (401/403) — refresh token hết hạn/đã xoay/đã thu hồi, phiên thật sự đã mất.
// unavailable  : chưa rõ (mất mạng, 5xx, API đang "thức dậy") — KHÔNG kết luận mất phiên, lần sau thử lại.
export type RefreshOutcome = 'refreshed' | 'skipped' | 'rejected' | 'unavailable';

const LOCK_NAME = 'auth-refresh';
const LAST_REFRESH_KEY = 'auth:lastRefreshAt';

// refresh token XOAY VÒNG và `User.refreshTokenHash` chỉ có MỘT cột: hai tab cùng gia hạn gần như đồng thời
// thì tab đến sau mang refresh token đã bị thay → 401 → tự đăng xuất người dùng. Tab giữ khoá thứ hai thấy
// mốc này còn mới thì bỏ qua việc gia hạn (cookie đã do tab kia đổi, dùng chung giữa các tab).
export const RECENT_REFRESH_WINDOW_MS = 10_000;

// Một lần gia hạn dùng chung trong tab này: N request cùng 401 chỉ sinh MỘT lần gọi refresh (token xoay
// vòng nên gọi N lần là N-1 lần thất bại và tự đá chính mình).
let inFlight: Promise<RefreshOutcome> | null = null;
let sessionLostHandler: (() => void) | null = null;

// api-client không import modules/auth (shared/ không phụ thuộc module nghiệp vụ) nên AuthHydrator đăng ký
// hàm xử lý "mất phiên" (xoá user khỏi store, điều hướng /login) qua đây.
export function setSessionLostHandler(handler: (() => void) | null): void {
  sessionLostHandler = handler;
}

// localStorage có thể ném lỗi (cửa sổ riêng tư, chặn dữ liệu trang) hoặc không có (SSR) — khi đó coi như
// không có mốc, chấp nhận khe hở hiếm: hai tab có thể cùng gia hạn.
function readLastRefreshAt(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_REFRESH_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastRefreshAt(timestamp: number): void {
  try {
    window.localStorage.setItem(LAST_REFRESH_KEY, String(timestamp));
  } catch {
    // Bỏ qua: không ghi được mốc chỉ làm mất bước chống đua giữa các tab, không ảnh hưởng gia hạn.
  }
}

function clearLastRefreshAt(): void {
  try {
    window.localStorage.removeItem(LAST_REFRESH_KEY);
  } catch {
    // Như trên.
  }
}

// Web Locks: chỉ một tab (cùng origin) chạy `task` tại một thời điểm, các tab còn lại xếp hàng. Trình
// duyệt không hỗ trợ thì chạy thẳng — vẫn còn bước kiểm mốc ở trên làm lớp phòng thủ thứ hai.
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  // Kiểu của lib.dom bọc thêm một lớp Promise quanh giá trị callback trả về, nhưng lúc chạy `request()` đã
  // tự "mở" Promise của callback — kết quả thật chỉ có một lớp.
  return locks ? (locks.request(LOCK_NAME, task) as unknown as Promise<T>) : task();
}

async function runRefreshFlow(callRefresh: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
  // Đọc mốc SAU KHI đã giữ khoá — nếu đọc trước, hai tab cùng thấy "chưa có mốc" rồi cùng gia hạn.
  const lastRefreshAt = readLastRefreshAt();
  if (lastRefreshAt !== null && Date.now() - lastRefreshAt < RECENT_REFRESH_WINDOW_MS) {
    return 'skipped';
  }

  const outcome = await callRefresh();
  if (outcome === 'refreshed') writeLastRefreshAt(Date.now());
  return outcome;
}

// Gia hạn phiên: trả kết quả để người gọi quyết định thử lại request hay không. Khi BE từ chối, gọi
// handler "mất phiên" ĐÚNG MỘT LẦN cho cả nhóm request đang chờ (nằm trong luồng dùng chung, không phải
// trong từng người gọi).
export function refreshSession(
  callRefresh: () => Promise<RefreshOutcome>,
): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;

  const flow = runExclusive(() => runRefreshFlow(callRefresh))
    .catch((): RefreshOutcome => 'unavailable')
    .then((outcome) => {
      if (outcome === 'rejected') {
        clearLastRefreshAt();
        sessionLostHandler?.();
      }
      return outcome;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = flow;
  return flow;
}
