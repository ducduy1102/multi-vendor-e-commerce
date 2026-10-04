import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import {
  login,
  logout,
  me,
  refresh,
  register,
  resendVerification,
  verifyEmail,
} from './auth.service';

const mockUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER',
  emailVerifiedAt: null,
};

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('auth.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login returns the parsed user on success', async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } });

    const result = await login({ email: 'user@example.com', password: 'password123' });

    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('register returns the parsed user on success', async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } }, 201);

    const result = await register({
      email: 'user@example.com',
      password: 'password123',
      name: 'Nguyen Van A',
    });

    expect(result).toEqual(mockUser);
  });

  it('throws ApiError with the BE message when the request fails', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Email hoặc mật khẩu không đúng' }, 401);

    await expect(login({ email: 'user@example.com', password: 'wrong' })).rejects.toMatchObject(
      new ApiError('Email hoặc mật khẩu không đúng', 401),
    );
  });

  it('refresh and logout resolve without throwing on success', async () => {
    mockFetchOnce({ success: true, data: { message: 'ok' } });
    await expect(refresh()).resolves.toBeUndefined();

    mockFetchOnce({ success: true, data: { message: 'ok' } });
    await expect(logout()).resolves.toBeUndefined();
  });

  it('me returns the parsed user when there is a valid session', async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } });

    const result = await me();

    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('me throws ApiError when there is no session (401)', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Unauthorized' }, 401);

    await expect(me()).rejects.toMatchObject(new ApiError('Unauthorized', 401));
  });

  it('verifyEmail posts the token and returns the BE message', async () => {
    mockFetchOnce({ success: true, data: { message: 'Xác thực email thành công' } });

    const result = await verifyEmail('raw-token');

    expect(result).toEqual({ message: 'Xác thực email thành công' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify-email'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'raw-token' }) }),
    );
  });

  it('verifyEmail throws ApiError when the token is invalid/expired', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Token xác thực đã hết hạn' }, 400);

    await expect(verifyEmail('expired-token')).rejects.toMatchObject(
      new ApiError('Token xác thực đã hết hạn', 400),
    );
  });

  it('resendVerification returns the BE message on success', async () => {
    mockFetchOnce({ success: true, data: { message: 'Đã gửi lại email xác thực' } });

    const result = await resendVerification();

    expect(result).toEqual({ message: 'Đã gửi lại email xác thực' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/resend-verification'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
