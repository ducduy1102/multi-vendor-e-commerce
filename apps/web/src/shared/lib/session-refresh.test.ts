import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_REFRESH_WINDOW_MS,
  refreshSession,
  setSessionLostHandler,
  type RefreshOutcome,
} from './session-refresh';

const LAST_REFRESH_KEY = 'auth:lastRefreshAt';

// Hàng đợi khoá kiểu Web Locks: mỗi lời gọi chờ lời gọi trước xong rồi mới chạy — đủ giống `navigator.locks`
// (cùng tên khoá, loại exclusive) để kiểm hai "tab" không gia hạn chồng nhau.
function createFakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const run = tail.then(() => callback());
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

describe('refreshSession', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    setSessionLostHandler(null);
    window.localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gọi callRefresh và trả đúng kết quả; refreshed ghi mốc lastRefreshAt', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await expect(refreshSession(callRefresh)).resolves.toBe('refreshed');

    expect(callRefresh).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LAST_REFRESH_KEY)).toBe('1700000000000');
  });

  it('N lời gọi đồng thời dùng chung MỘT lần gọi refresh (token xoay vòng nên gọi N lần là tự đá chính mình)', async () => {
    let finish!: (outcome: RefreshOutcome) => void;
    const callRefresh = vi.fn(
      () =>
        new Promise<RefreshOutcome>((resolve) => {
          finish = resolve;
        }),
    );

    const calls = Array.from({ length: 5 }, () => refreshSession(callRefresh));
    // Chờ khoá/vi tác vụ để callRefresh thật sự được gọi trước khi hoàn tất.
    await vi.waitFor(() => expect(callRefresh).toHaveBeenCalled());
    finish('refreshed');

    await expect(Promise.all(calls)).resolves.toEqual(Array(5).fill('refreshed'));
    expect(callRefresh).toHaveBeenCalledTimes(1);
  });

  it('xong rồi thì lần gọi sau (ngoài cửa sổ mốc) gọi refresh lại — không dính kết quả cũ', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await refreshSession(callRefresh);
    vi.setSystemTime(1_700_000_000_000 + RECENT_REFRESH_WINDOW_MS + 1);
    await refreshSession(callRefresh);

    expect(callRefresh).toHaveBeenCalledTimes(2);
  });

  it('mốc lastRefreshAt còn mới (< 10 giây) ⇒ bỏ qua gia hạn, trả skipped, KHÔNG gọi refresh', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    window.localStorage.setItem(LAST_REFRESH_KEY, String(1_700_000_000_000 - 9_999));
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await expect(refreshSession(callRefresh)).resolves.toBe('skipped');

    expect(callRefresh).not.toHaveBeenCalled();
  });

  it('mốc đúng 10 giây trước ⇒ đã hết cửa sổ, gia hạn thật', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    window.localStorage.setItem(
      LAST_REFRESH_KEY,
      String(1_700_000_000_000 - RECENT_REFRESH_WINDOW_MS),
    );
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await expect(refreshSession(callRefresh)).resolves.toBe('refreshed');
  });

  it('mốc hỏng (không phải số) ⇒ coi như chưa có mốc', async () => {
    window.localStorage.setItem(LAST_REFRESH_KEY, 'khong-phai-so');
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await expect(refreshSession(callRefresh)).resolves.toBe('refreshed');
    expect(callRefresh).toHaveBeenCalledTimes(1);
  });

  it('localStorage ném lỗi (cửa sổ riêng tư) ⇒ vẫn gia hạn bình thường', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const callRefresh = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);

    await expect(refreshSession(callRefresh)).resolves.toBe('refreshed');
  });

  describe('BE từ chối (rejected)', () => {
    it('gọi handler mất phiên ĐÚNG MỘT LẦN cho cả nhóm lời gọi đồng thời, và xoá mốc cũ', async () => {
      window.localStorage.setItem(LAST_REFRESH_KEY, '1');
      const handler = vi.fn();
      setSessionLostHandler(handler);
      const callRefresh = vi.fn().mockResolvedValue('rejected' satisfies RefreshOutcome);

      const results = await Promise.all([
        refreshSession(callRefresh),
        refreshSession(callRefresh),
        refreshSession(callRefresh),
      ]);

      expect(results).toEqual(['rejected', 'rejected', 'rejected']);
      expect(callRefresh).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(LAST_REFRESH_KEY)).toBeNull();
    });

    it('không đăng ký handler ⇒ không lỗi', async () => {
      const callRefresh = vi.fn().mockResolvedValue('rejected' satisfies RefreshOutcome);

      await expect(refreshSession(callRefresh)).resolves.toBe('rejected');
    });
  });

  describe('chưa rõ kết quả (unavailable)', () => {
    it('KHÔNG gọi handler mất phiên và KHÔNG ghi mốc (mất mạng/API đang thức dậy không phải mất phiên)', async () => {
      const handler = vi.fn();
      setSessionLostHandler(handler);
      const callRefresh = vi.fn().mockResolvedValue('unavailable' satisfies RefreshOutcome);

      await expect(refreshSession(callRefresh)).resolves.toBe('unavailable');

      expect(handler).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(LAST_REFRESH_KEY)).toBeNull();
    });

    it('callRefresh ném lỗi bất ngờ ⇒ unavailable, lần gọi sau vẫn chạy được (inFlight không kẹt)', async () => {
      const failing = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(refreshSession(failing)).resolves.toBe('unavailable');

      const ok = vi.fn().mockResolvedValue('refreshed' satisfies RefreshOutcome);
      await expect(refreshSession(ok)).resolves.toBe('refreshed');
    });
  });

  describe('hai tab (Web Locks)', () => {
    it('hai tab cùng gia hạn ⇒ chỉ MỘT tab gọi refresh, tab kia nhận skipped (refresh token xoay vòng nên gọi hai lần là tab chậm 401 và tự đăng xuất)', async () => {
      vi.stubGlobal('navigator', { locks: createFakeLocks() });
      // Hai bản module riêng = hai tab: mỗi tab có `inFlight` riêng, chỉ chia sẻ khoá và localStorage.
      vi.resetModules();
      const tabA = await import('./session-refresh');
      vi.resetModules();
      const tabB = await import('./session-refresh');

      const callRefresh = vi.fn(async (): Promise<RefreshOutcome> => {
        await Promise.resolve();
        return 'refreshed';
      });

      const outcomes = await Promise.all([
        tabA.refreshSession(callRefresh),
        tabB.refreshSession(callRefresh),
      ]);

      expect(callRefresh).toHaveBeenCalledTimes(1);
      expect([...outcomes].sort()).toEqual(['refreshed', 'skipped']);
    });
  });
});
