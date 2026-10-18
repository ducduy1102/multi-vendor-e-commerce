import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from './api-client';
import { setSessionLostHandler } from './session-refresh';

function mockFetchResolved(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('thành công -> trả về data, không ném lỗi', async () => {
    mockFetchResolved({ success: true, data: { id: '1' } });

    await expect(apiFetch('/x')).resolves.toEqual({ id: '1' });
  });

  it('lỗi có code/details (AppException, Week7.md 1.16) -> ApiError giữ nguyên cả 2', async () => {
    mockFetchResolved(
      { success: false, data: null, message: 'Voucher has expired', code: 'VOUCHER_EXPIRED' },
      400,
    );

    await expect(apiFetch('/x')).rejects.toMatchObject({
      status: 400,
      message: 'Voucher has expired',
      code: 'VOUCHER_EXPIRED',
      details: undefined,
    });
  });

  it('lỗi có details -> ApiError giữ nguyên details thô (chưa parse Zod)', async () => {
    mockFetchResolved(
      {
        success: false,
        data: null,
        message: 'Quantity exceeds available stock (3)',
        code: 'INSUFFICIENT_STOCK',
        details: { available: 3 },
      },
      409,
    );

    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INSUFFICIENT_STOCK');
    expect((error as ApiError).details).toEqual({ available: 3 });
  });

  it('lỗi CHƯA di chuyển sang mã (chỉ có message, đúng hình dạng cũ) -> code undefined', async () => {
    mockFetchResolved({ success: false, data: null, message: 'Something went wrong' }, 500);

    await expect(apiFetch('/x')).rejects.toMatchObject({
      status: 500,
      message: 'Something went wrong',
      code: undefined,
    });
  });

  it('mất mạng (fetch() ném lỗi) -> ApiError status 0, code NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
  });

  it('phản hồi không phải JSON hợp lệ -> ApiError giữ status thật, code INVALID_RESPONSE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      }),
    );

    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).code).toBe('INVALID_RESPONSE');
  });

  it('phản hồi 200 nhưng body không phải JSON hợp lệ -> vẫn INVALID_RESPONSE (không coi là thành công)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      }),
    );

    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_RESPONSE');
  });
});

// Tự gia hạn phiên khi gặp 401 (Week10.md 2.1). access_token sống 15 phút, refresh_token 7 ngày.
describe('apiFetch — tự gia hạn phiên khi 401', () => {
  const LAST_REFRESH_KEY = 'auth:lastRefreshAt';
  const BASE = 'http://localhost:4000/api/v1';

  interface FakeApi {
    fetchMock: ReturnType<typeof vi.fn>;
    paths: () => string[];
    count: (path: string) => number;
  }

  const json = (body: unknown, status: number) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

  // Mô phỏng BE: mọi đường dẫn thường trả 401 cho tới khi `/auth/refresh` thành công (đổi cookie), sau đó
  // trả 200. `refreshStatus` điều khiển kết quả của lệnh gia hạn.
  function installApi(options: { refreshStatus?: number; refreshThrows?: boolean } = {}): FakeApi {
    let tokenValid = false;
    const fetchMock = vi.fn((url: string) => {
      const path = url.replace(BASE, '');
      if (path === '/auth/refresh') {
        if (options.refreshThrows) return Promise.reject(new TypeError('Failed to fetch'));
        const status = options.refreshStatus ?? 200;
        if (status === 200) tokenValid = true;
        return Promise.resolve(
          json(
            status === 200
              ? { success: true, data: { message: 'ok' } }
              : { success: false, data: null, message: 'Unauthorized' },
            status,
          ),
        );
      }
      return Promise.resolve(
        tokenValid
          ? json({ success: true, data: { path } }, 200)
          : json({ success: false, data: null, message: 'Unauthorized' }, 401),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const paths = () => fetchMock.mock.calls.map(([url]) => (url as string).replace(BASE, ''));
    return { fetchMock, paths, count: (path) => paths().filter((p) => p === path).length };
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    setSessionLostHandler(null);
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('401 → gia hạn đúng một lần → thử lại đúng một lần → trả dữ liệu như bình thường', async () => {
    const api = installApi();

    await expect(apiFetch('/orders')).resolves.toEqual({ path: '/orders' });

    expect(api.paths()).toEqual(['/orders', '/auth/refresh', '/orders']);
  });

  it('lệnh gia hạn gửi POST kèm cookie (credentials: include)', async () => {
    const api = installApi();

    await apiFetch('/orders');

    const [, refreshInit] = api.fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshInit.method).toBe('POST');
    expect(refreshInit.credentials).toBe('include');
  });

  it('thử lại giữ nguyên method và body của request gốc', async () => {
    const api = installApi();

    await apiFetch('/cart/items', { method: 'POST', body: JSON.stringify({ quantity: 2 }) });

    const calls = api.fetchMock.mock.calls as [string, RequestInit][];
    expect(calls[0][1]).toMatchObject({ method: 'POST', body: '{"quantity":2}' });
    expect(calls[2][1]).toMatchObject({ method: 'POST', body: '{"quantity":2}' });
  });

  it('5 request 401 song song ⇒ đúng MỘT lần gọi refresh (refresh token xoay vòng, gọi nhiều lần là tự đá chính mình)', async () => {
    const api = installApi();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => apiFetch(`/orders?page=${i}`)),
    );

    expect(results).toHaveLength(5);
    expect(api.count('/auth/refresh')).toBe(1);
    // 5 lần đầu 401 + 1 refresh + 5 lần thử lại.
    expect(api.fetchMock).toHaveBeenCalledTimes(11);
  });

  it('gia hạn bị từ chối (401) ⇒ gọi handler mất phiên, ném lại ĐÚNG lỗi 401 gốc, KHÔNG thử lại', async () => {
    const api = installApi({ refreshStatus: 401 });
    const onSessionLost = vi.fn();
    setSessionLostHandler(onSessionLost);

    const error = await apiFetch('/orders').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('Unauthorized');
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(api.paths()).toEqual(['/orders', '/auth/refresh']);
  });

  it('gia hạn bị từ chối (403) cũng là mất phiên', async () => {
    installApi({ refreshStatus: 403 });
    const onSessionLost = vi.fn();
    setSessionLostHandler(onSessionLost);

    await expect(apiFetch('/orders')).rejects.toMatchObject({ status: 401 });

    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('nhiều request cùng gặp mất phiên ⇒ handler chỉ được gọi MỘT lần', async () => {
    installApi({ refreshStatus: 401 });
    const onSessionLost = vi.fn();
    setSessionLostHandler(onSessionLost);

    const results = await Promise.allSettled([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('thử lại vẫn 401 ⇒ trả lỗi, không vòng lặp (tối đa 1 lần gia hạn + 1 lần thử lại)', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/auth/refresh')
          ? json({ success: true, data: { message: 'ok' } }, 200)
          : json({ success: false, data: null, message: 'Unauthorized' }, 401),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/orders')).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('mất mạng khi gia hạn ⇒ KHÔNG coi là mất phiên (không gọi handler), người gọi nhận lỗi 401 gốc', async () => {
    installApi({ refreshThrows: true });
    const onSessionLost = vi.fn();
    setSessionLostHandler(onSessionLost);

    await expect(apiFetch('/orders')).rejects.toMatchObject({ status: 401 });

    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('gia hạn gặp 5xx (API đang thức dậy) ⇒ KHÔNG coi là mất phiên', async () => {
    installApi({ refreshStatus: 503 });
    const onSessionLost = vi.fn();
    setSessionLostHandler(onSessionLost);

    await expect(apiFetch('/orders')).rejects.toMatchObject({ status: 401 });

    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it.each([
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
  ])(
    '%s trả 401 ⇒ KHÔNG gia hạn (401 ở đây là lỗi nghiệp vụ, hoặc chính là lệnh gia hạn)',
    async (path) => {
      // refreshStatus 401 để chính `/auth/refresh` cũng trả 401 (các đường dẫn còn lại 401 vì chưa gia hạn).
      const api = installApi({ refreshStatus: 401 });

      await expect(apiFetch(path, { method: 'POST' })).rejects.toMatchObject({ status: 401 });

      // Chỉ đúng một lần gọi: không có /auth/refresh nào được thêm vào.
      expect(api.paths()).toEqual([path]);
    },
  );

  it('/auth/logout CÓ gia hạn rồi thử lại: access token đã hết hạn mà logout 401 thì refresh token KHÔNG bị thu hồi và cookie còn sống 7 ngày', async () => {
    const api = installApi();

    await apiFetch('/auth/logout', { method: 'POST' });

    expect(api.paths()).toEqual(['/auth/logout', '/auth/refresh', '/auth/logout']);
  });

  it('đường dẫn có query vẫn được nhận diện (không gia hạn cho /auth/login?x=1)', async () => {
    const api = installApi();

    await expect(apiFetch('/auth/login?x=1', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
    });
    expect(api.count('/auth/refresh')).toBe(0);
  });

  it('lỗi khác 401 (403, 409, 500) ⇒ không gia hạn', async () => {
    for (const status of [403, 409, 500]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(json({ success: false, data: null, message: 'x' }, status));
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiFetch('/orders')).rejects.toMatchObject({ status });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('mốc lastRefreshAt còn mới (< 10 giây — tab khác vừa gia hạn) ⇒ KHÔNG gọi refresh, chỉ thử lại request', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(() => {
      attempt += 1;
      return Promise.resolve(
        attempt === 1
          ? json({ success: false, data: null, message: 'Unauthorized' }, 401)
          : json({ success: true, data: { ok: true } }, 200),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem(LAST_REFRESH_KEY, String(Date.now() - 1_000));

    await expect(apiFetch('/orders')).resolves.toEqual({ ok: true });

    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls.some((url) => url.endsWith('/auth/refresh'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gia hạn thành công ⇒ ghi mốc lastRefreshAt (để tab khác biết mà bỏ qua)', async () => {
    installApi();

    await apiFetch('/orders');

    const mark = Number(window.localStorage.getItem(LAST_REFRESH_KEY));
    expect(Number.isFinite(mark)).toBe(true);
    expect(Date.now() - mark).toBeLessThan(5_000);
  });
});
