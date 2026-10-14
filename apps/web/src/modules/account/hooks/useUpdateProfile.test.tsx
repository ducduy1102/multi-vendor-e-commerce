import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';

import * as accountService from '../services/account.service';
import { useUpdateProfile } from './useUpdateProfile';

vi.mock('../services/account.service', () => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
}));

const before = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Tên cũ',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useUpdateProfile', () => {
  beforeEach(() => {
    vi.mocked(accountService.updateProfile).mockReset();
    useAuthStore.getState().setUser(before);
  });

  afterEach(() => {
    useAuthStore.getState().clearUser();
  });

  it('lưu thành công -> gọi service với input và ghi user MỚI vào store (Header đọc tên từ đây)', async () => {
    const after = { ...before, name: 'Tên mới', locale: 'en' as const };
    vi.mocked(accountService.updateProfile).mockResolvedValue(after);
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });

    await act(() => result.current.mutateAsync({ name: 'Tên mới', locale: 'en' }));

    expect(accountService.updateProfile).toHaveBeenCalledWith({ name: 'Tên mới', locale: 'en' });
    expect(useAuthStore.getState().user).toEqual(after);
  });

  it('lưu lỗi -> store GIỮ NGUYÊN user cũ, lỗi được ném lại cho Container', async () => {
    vi.mocked(accountService.updateProfile).mockRejectedValue(new ApiError('boom', 500));
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ name: 'Tên mới' })).rejects.toBeInstanceOf(
        ApiError,
      );
    });

    expect(useAuthStore.getState().user).toEqual(before);
  });
});
