import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { changePassword, updateProfile } from './account.service';

const mockUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van B',
  role: 'USER',
  emailVerifiedAt: null,
  locale: 'en',
  hasPassword: true,
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

describe('account.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updateProfile: PATCH /auth/me, trả user đã parse', async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } });

    const result = await updateProfile({ name: 'Nguyen Van B', locale: 'en' });

    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ name: 'Nguyen Van B', locale: 'en' }),
      }),
    );
  });

  it('updateProfile: response thiếu field của user thì bị Zod từ chối (không tin nguyên xi)', async () => {
    mockFetchOnce({ success: true, data: { user: { id: 'user-1', email: 'a@b.co' } } });

    await expect(updateProfile({ name: 'X' })).rejects.toThrow();
  });

  it('changePassword: POST /auth/change-password với đúng 2 field BE nhận', async () => {
    mockFetchOnce({ success: true, data: { message: 'Đã đổi mật khẩu' } });

    await expect(
      changePassword({ currentPassword: 'old-password-1', newPassword: 'new-password-2' }),
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/change-password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'old-password-1', newPassword: 'new-password-2' }),
      }),
    );
  });

  it.each(['CURRENT_PASSWORD_INCORRECT', 'PASSWORD_NOT_SET'])(
    'changePassword: giữ nguyên `code` %s của BE để Container nhận diện',
    async (code) => {
      mockFetchOnce({ success: false, data: null, message: 'x', code }, 400);

      const error = await changePassword({
        currentPassword: 'old-password-1',
        newPassword: 'new-password-2',
      }).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 400, code });
    },
  );
});
