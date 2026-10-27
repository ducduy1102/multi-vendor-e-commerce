import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminUserDetailQueryKey, adminUserListQueryKey } from './admin-query-keys';
import { useAdminUserDetail } from './useAdminUserDetail';
import { useAdminUsers } from './useAdminUsers';

vi.mock('../services/admin.service', () => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAdminUsers', () => {
  beforeEach(() => {
    vi.mocked(adminService.listUsers).mockReset();
  });

  it('gọi service với đúng bộ lọc, lưu dưới key riêng của từng tổ hợp bộ lọc/trang', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 };
    vi.mocked(adminService.listUsers).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { status: 'BANNED' as const, role: 'USER' as const, q: 'an', page: 2 };

    const { result } = renderHook(() => useAdminUsers(query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.listUsers).toHaveBeenCalledWith(query);
    expect(queryClient.getQueryData(adminUserListQueryKey(query))).toEqual(page);
    expect(queryClient.getQueryData(adminUserListQueryKey({ ...query, page: 3 }))).toBeUndefined();
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.listUsers).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminUsers({}), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.listUsers).toHaveBeenCalledTimes(1);
    },
  );
});

describe('useAdminUserDetail', () => {
  beforeEach(() => {
    vi.mocked(adminService.getUser).mockReset();
  });

  it('có id -> gọi service và lưu dưới key của đúng người dùng đó', async () => {
    const detail = { id: 'u-1' } as never;
    vi.mocked(adminService.getUser).mockResolvedValue(detail);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useAdminUserDetail('u-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.getUser).toHaveBeenCalledWith('u-1');
    expect(queryClient.getQueryData(adminUserDetailQueryKey('u-1'))).toBe(detail);
  });

  it('ngăn đang đóng (không có id, hoặc enabled=false) -> KHÔNG gọi API', async () => {
    const { wrapper } = setup();

    renderHook(() => useAdminUserDetail(undefined), { wrapper });
    renderHook(() => useAdminUserDetail('u-1', false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adminService.getUser).not.toHaveBeenCalled();
  });

  it('404 -> báo lỗi ngay, không thử lại (kết quả chắc chắn)', async () => {
    vi.mocked(adminService.getUser).mockRejectedValue(new ApiError('x', 404, 'USER_NOT_FOUND'));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAdminUserDetail('u-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(adminService.getUser).toHaveBeenCalledTimes(1);
  });
});
