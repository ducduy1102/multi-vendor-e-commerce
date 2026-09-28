import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from './api-client';

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
