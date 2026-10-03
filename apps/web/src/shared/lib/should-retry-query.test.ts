import { describe, expect, it } from 'vitest';

import { ApiError } from './api-client';
import { shouldRetryQuery } from './should-retry-query';

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409])('lỗi %s (4xx) -> không thử lại', (status) => {
    expect(shouldRetryQuery(0, new ApiError('x', status))).toBe(false);
  });

  it('lỗi 5xx -> thử lại tối đa 2 lần', () => {
    const error = new ApiError('x', 503);
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it('mất mạng (status 0) -> thử lại tối đa 2 lần (không phải lỗi 4xx của request)', () => {
    const error = new ApiError('Network error', 0, 'NETWORK_ERROR');
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(false);
  });

  it('lỗi không phải ApiError -> thử lại tối đa 2 lần', () => {
    expect(shouldRetryQuery(1, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('boom'))).toBe(false);
  });
});
