import { REALTIME_EVENTS } from '@ecommerce/types';

import type { RefreshOutcome } from '@/shared/lib/session-refresh';

// Bộ điều khiển kết nối real-time phía trình duyệt (Week10.md 3.5): một kết nối Socket.io, nối lại có backoff,
// gia hạn phiên khi server báo hết hạn/từ chối xác thực. KHÔNG phụ thuộc React hay `socket.io-client`: socket
// đến từ `createSocket` được truyền vào (mặc định nạp động `socket.io-client`, xem socket-factory.ts), nên test
// được bằng socket giả + fake timers và khách vãng lai không tải thêm byte nào.
//
// Vì sao tự nối lại thay vì dùng `reconnection` của socket.io: lỗi do MIDDLEWARE của server từ chối (token sai/hết
// hạn/tài khoản khoá) và việc server chủ động ngắt ("io server disconnect") đều KHÔNG được socket.io tự nối
// lại, trong khi ta cần xử lý khác nhau cho từng lý do (gia hạn phiên rồi nối lại / dừng hẳn / chờ). Gom hết vào
// một chỗ để có đúng một bộ đếm lần thử và một lịch backoff.

export type RealtimeStatus = 'connecting' | 'connected' | 'offline';

// Phần của socket.io-client `Socket` mà bộ điều khiển dùng, khai bằng interface cấu trúc để fake được dễ dàng.
export interface RealtimeClientSocket {
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'connect_error', listener: (error: Error) => void): unknown;
  on(event: 'disconnect', listener: (reason: string) => void): unknown;
  onAny(listener: (event: string, ...args: unknown[]) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
  // Gửi một sự kiện client → server (hiện chỉ có `chat:typing`).
  emit(event: string, payload?: unknown): unknown;
}

export interface RealtimeSocketOptions {
  // Khớp server (D11): chỉ websocket, không long-polling.
  transports: ['websocket'];
  withCredentials: true;
  // Tự nối lại do bộ điều khiển đảm nhiệm (xem đầu file).
  reconnection: false;
  // Bộ điều khiển tự gọi connect() sau khi gắn listener: socket tạo muộn (sau stop) không tự kết nối.
  autoConnect: false;
  timeout: number;
}

export type SocketFactory = (
  url: string,
  options: RealtimeSocketOptions,
) => Promise<RealtimeClientSocket>;

export const CONNECT_TIMEOUT_MS = 10_000;
export const RECONNECT_BASE_DELAY_MS = 2_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
// Kết nối phải sống liên tục chừng này thì bộ đếm lần thử mới về 0. Nếu về 0 ngay khi vừa nối được thì một vòng
// "bị ngắt → nối lại → lại bị ngắt" (vd quá 5 tab) sẽ quay ở nhịp nhanh nhất mãi mãi.
export const STABLE_CONNECTION_MS = 30_000;

// Backoff mũ có "jitter một nửa": nằm trong [trần/2, trần] với trần = min(MAX, BASE × 2^lần). Cận dưới giữ nhịp
// không bao giờ quá nhanh (lần đầu ≥ 1s — đủ để đăng xuất xong huỷ được lần nối lại); cận ngẫu nhiên tránh mọi
// tab/người dùng cùng nối lại đúng một lúc sau khi API khởi động lại.
export function computeReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

export interface RealtimeClientOptions {
  url: string;
  createSocket: SocketFactory;
  // Gia hạn phiên (POST /auth/refresh, dùng chung một lần + khoá giữa các tab — session-refresh.ts).
  refreshSession: () => Promise<RefreshOutcome>;
  random?: () => number;
  isVisible?: () => boolean;
  // Đăng ký nhận thông báo "tab vừa hiện lại"; trả về hàm huỷ đăng ký.
  onVisible?: (listener: () => void) => () => void;
}

export interface RealtimeClient {
  start(): void;
  stop(): void;
  getStatus(): RealtimeStatus;
  subscribeStatus(listener: () => void): () => void;
  // Nghe một sự kiện server → client; payload chưa được kiểm (nơi dùng tự parse bằng Zod).
  subscribeEvent(event: string, handler: (payload: unknown) => void): () => void;
  // Gửi một sự kiện lên server. Trả `true` nếu đã giao cho socket đang KẾT NỐI, `false` nếu không gửi (chưa nối,
  // đang nối lại, đã dừng): sự kiện kiểu "đang gõ" chỉ có nghĩa ngay lúc này nên KHÔNG xếp hàng chờ gửi sau.
  emitEvent(event: string, payload?: unknown): boolean;
}

function documentIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function subscribeDocumentVisible(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const onChange = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const {
    url,
    createSocket,
    refreshSession,
    random = Math.random,
    isVisible = documentIsVisible,
    onVisible = subscribeDocumentVisible,
  } = options;

  let status: RealtimeStatus = 'offline';
  const statusListeners = new Set<() => void>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  let started = false;
  // Đổi mỗi lần start/stop: mọi kết quả bất đồng bộ (nạp thư viện, gia hạn phiên) mang theo số này và bị bỏ nếu
  // đã cũ — kể cả StrictMode (start → stop → start) chỉ tạo đúng MỘT socket.
  let generation = 0;
  let socket: RealtimeClientSocket | null = null;
  let attempt = 0;
  let refreshing = false;
  // Đã gia hạn trong lượt này mà vẫn bị từ chối xác thực ⇒ dừng, không gia hạn vòng vòng.
  let refreshUsed = false;
  // Server vừa gửi `auth:expired`: lần ngắt kế tiếp là hết hạn token (cần gia hạn), không phải bị đá thường.
  let expiredNoticeReceived = false;
  let deferred: 'reconnect' | 'refresh' | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let stopWatchingVisibility: (() => void) | null = null;

  function setStatus(next: RealtimeStatus) {
    if (status === next) return;
    status = next;
    for (const listener of [...statusListeners]) listener();
  }

  function clearRetryTimer() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function clearStableTimer() {
    if (stableTimer !== null) clearTimeout(stableTimer);
    stableTimer = null;
  }

  function dispatch(event: string, payload: unknown) {
    const handlers = eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        // Lỗi của một handler không được làm hỏng các handler khác hay chính kết nối.
        console.error(error);
      }
    }
  }

  async function open(forGeneration: number) {
    // Nhường một microtask: StrictMode gọi start → stop → start liền nhau trong cùng một tick, nên lần start
    // đầu thấy mình đã cũ TRƯỚC khi chạm tới `createSocket` — chỉ lần start thật mới tạo socket.
    await Promise.resolve();
    if (forGeneration !== generation) return;

    let created: RealtimeClientSocket;
    try {
      created = await createSocket(url, {
        transports: ['websocket'],
        withCredentials: true,
        reconnection: false,
        autoConnect: false,
        timeout: CONNECT_TIMEOUT_MS,
      });
    } catch {
      // Không nạp được thư viện (mất mạng, lỗi tải chunk): thử lại theo backoff.
      if (forGeneration === generation) scheduleReconnect();
      return;
    }
    if (forGeneration !== generation) return; // đã stop trong lúc chờ: bỏ socket chưa kết nối này

    socket = created;
    created.on('connect', () => {
      if (socket === created) onConnected();
    });
    created.on('connect_error', (error) => {
      if (socket === created) onConnectError(error.message);
    });
    created.on('disconnect', (reason) => {
      if (socket === created) onDisconnected(reason);
    });
    created.onAny((event, ...args) => {
      if (socket !== created) return;
      if (event === REALTIME_EVENTS.authExpired) expiredNoticeReceived = true;
      dispatch(event, args[0]);
    });
    created.connect();
  }

  function connectNow() {
    clearRetryTimer();
    setStatus('connecting');
    if (socket) socket.connect();
    else void open(generation);
  }

  function scheduleReconnect() {
    clearRetryTimer();
    setStatus('connecting');
    const delay = computeReconnectDelay(attempt, random);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connectNow();
    }, delay);
  }

  // Dừng hẳn, không thử lại (tài khoản bị khoá, cấu hình sai, phiên đã mất...).
  function giveUp() {
    clearRetryTimer();
    clearStableTimer();
    setStatus('offline');
  }

  function onConnected() {
    clearRetryTimer();
    refreshUsed = false;
    expiredNoticeReceived = false;
    setStatus('connected');
    clearStableTimer();
    stableTimer = setTimeout(() => {
      stableTimer = null;
      attempt = 0;
    }, STABLE_CONNECTION_MS);
  }

  function onConnectError(message: string) {
    clearStableTimer();
    switch (message) {
      case 'MISSING_TOKEN':
      case 'INVALID_TOKEN':
        void recoverWithRefresh();
        return;
      case 'ACCOUNT_NOT_ACTIVE':
      case 'FORBIDDEN_ORIGIN':
        giveUp();
        return;
      default:
        // AUTH_UNAVAILABLE, TOO_MANY_ATTEMPTS và mọi lỗi đường truyền ('websocket error', 'timeout'...).
        scheduleReconnect();
    }
  }

  function onDisconnected(reason: string) {
    clearStableTimer();
    if (reason === 'io client disconnect') {
      setStatus('offline');
      return;
    }
    if (reason !== 'io server disconnect') {
      // Mất đường truyền (transport close, ping timeout...): nối lại theo backoff, bất kể tab đang ẩn hay hiện.
      scheduleReconnect();
      return;
    }
    // Server chủ động ngắt. Hết hạn token ⇒ gia hạn phiên rồi nối lại. Còn lại (bị đá vì mở quá 5 kết nối, đổi
    // mật khẩu...) ⇒ chỉ tab đang HIỂN THỊ mới nối lại: tab ẩn nối lại sẽ đá một tab khác, các tab đá nhau mãi.
    if (expiredNoticeReceived) {
      expiredNoticeReceived = false;
      void recoverWithRefresh();
    } else if (isVisible()) {
      scheduleReconnect();
    } else {
      defer('reconnect');
    }
  }

  // Gia hạn phiên rồi nối lại, đúng MỘT lần cho mỗi lượt xác thực lỗi. Chỉ chạy khi tab đang hiển thị: tab bị bỏ
  // quên (laptop để mở qua đêm) mà tự gia hạn mỗi 15 phút thì phiên sống mãi, trái với hạn 7 ngày của refresh
  // token; để tab đó ngoại tuyến tới khi người dùng quay lại thì phiên hết đúng hạn.
  async function recoverWithRefresh() {
    if (refreshing) return;
    if (!isVisible()) {
      defer('refresh');
      return;
    }
    if (refreshUsed) {
      giveUp();
      return;
    }
    refreshUsed = true;
    refreshing = true;
    setStatus('connecting');
    const forGeneration = generation;
    let outcome: RefreshOutcome;
    try {
      outcome = await refreshSession();
    } catch {
      outcome = 'unavailable';
    }
    // Lượt cũ (đã stop, có thể đã start lại) không được đụng vào cờ của lượt mới.
    if (forGeneration !== generation) return;
    refreshing = false;

    if (outcome === 'refreshed' || outcome === 'skipped') {
      connectNow();
    } else if (outcome === 'unavailable') {
      // Chưa rõ (mất mạng, API đang thức dậy): chưa gia hạn được nên cho phép thử gia hạn lại ở lượt sau.
      refreshUsed = false;
      scheduleReconnect();
    } else {
      // 'rejected': phiên đã mất; refreshSession đã gọi handler "mất phiên" (đưa về /login).
      giveUp();
    }
  }

  function defer(action: 'reconnect' | 'refresh') {
    deferred = action;
    clearRetryTimer();
    setStatus('offline');
    stopWatchingVisibility ??= onVisible(() => {
      stopWatchingVisibility?.();
      stopWatchingVisibility = null;
      const pending = deferred;
      deferred = null;
      if (pending === 'refresh') void recoverWithRefresh();
      else if (pending === 'reconnect') scheduleReconnect();
    });
  }

  return {
    start() {
      if (started) return;
      started = true;
      generation += 1;
      setStatus('connecting');
      void open(generation);
    },
    stop() {
      started = false;
      generation += 1;
      clearRetryTimer();
      clearStableTimer();
      stopWatchingVisibility?.();
      stopWatchingVisibility = null;
      deferred = null;
      attempt = 0;
      refreshing = false;
      refreshUsed = false;
      expiredNoticeReceived = false;
      const current = socket;
      socket = null;
      if (current) {
        try {
          current.disconnect();
        } catch {
          // Đang dọn: socket hỏng thì bỏ qua.
        }
      }
      setStatus('offline');
    },
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    emitEvent(event, payload) {
      if (status !== 'connected' || !socket) return false;
      try {
        socket.emit(event, payload);
        return true;
      } catch {
        // Socket hỏng giữa chừng: coi như chưa gửi được, việc nối lại do bộ điều khiển đảm nhiệm.
        return false;
      }
    },
    subscribeEvent(event, handler) {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) eventHandlers.delete(event);
      };
    },
  };
}
