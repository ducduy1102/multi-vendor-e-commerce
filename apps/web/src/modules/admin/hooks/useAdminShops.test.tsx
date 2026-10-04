import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminShopListQueryKey } from './admin-query-keys';
import { useAdminShops } from './useAdminShops';

vi.mock('../services/admin.service', () => ({
  listShops: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAdminShops', () => {
  beforeEach(() => {
    vi.mocked(adminService.listShops).mockReset();
  });

  it('gọi service với status/page, lưu dưới key riêng của từng tab/trang', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 };
    vi.mocked(adminService.listShops).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { status: 'SUSPENDED' as const, page: 2 };

    const { result } = renderHook(() => useAdminShops(query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.listShops).toHaveBeenCalledWith(query);
    expect(queryClient.getQueryData(adminShopListQueryKey(query))).toEqual(page);
    expect(
      queryClient.getQueryData(adminShopListQueryKey({ status: 'APPROVED', page: 2 })),
    ).toBeUndefined();
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.listShops).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminShops(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.listShops).toHaveBeenCalledTimes(1);
    },
  );
});
