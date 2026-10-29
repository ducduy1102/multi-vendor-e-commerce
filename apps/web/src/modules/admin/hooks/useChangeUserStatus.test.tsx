import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { useChangeUserStatus } from './useChangeUserStatus';

vi.mock('../services/admin.service', () => ({
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useChangeUserStatus', () => {
  beforeEach(() => {
    vi.mocked(adminService.suspendUser).mockReset();
    vi.mocked(adminService.reactivateUser).mockReset();
  });

  it.each([
    ['suspend', 'SUSPENDED'],
    ['ban', 'BANNED'],
  ] as const)('%s -> POST suspend với mức %s và lý do', async (action, status) => {
    vi.mocked(adminService.suspendUser).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useChangeUserStatus(), { wrapper });

    await act(() => result.current.mutateAsync({ userId: 'u-1', action, reason: 'Vi phạm' }));

    expect(adminService.suspendUser).toHaveBeenCalledWith('u-1', { status, reason: 'Vi phạm' });
    expect(adminService.reactivateUser).not.toHaveBeenCalled();
  });

  it.each(['reactivate', 'unban'] as const)(
    '%s -> POST reactivate chỉ với lý do (không có mức)',
    async (action) => {
      vi.mocked(adminService.reactivateUser).mockResolvedValue({} as never);
      const { wrapper } = setup();
      const { result } = renderHook(() => useChangeUserStatus(), { wrapper });

      await act(() => result.current.mutateAsync({ userId: 'u-1', action, reason: 'Đã xét lại' }));

      expect(adminService.reactivateUser).toHaveBeenCalledWith('u-1', { reason: 'Đã xét lại' });
      expect(adminService.suspendUser).not.toHaveBeenCalled();
    },
  );

  it('thành công -> làm mới MỌI danh sách và chi tiết người dùng, cả danh sách shop (shop bị kéo theo)', async () => {
    vi.mocked(adminService.suspendUser).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useChangeUserStatus(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ userId: 'u-1', action: 'suspend', reason: 'Vi phạm' }),
    );

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'detail'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'shops', 'list'] });
  });

  it('lỗi (vd 409 Admin khác vừa xử lý) -> ném lại và VẪN làm mới (dữ liệu đang hiển thị đã cũ)', async () => {
    vi.mocked(adminService.suspendUser).mockRejectedValue(new Error('boom'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useChangeUserStatus(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ userId: 'u-1', action: 'ban', reason: 'x' });
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'detail'] });
  });
});
