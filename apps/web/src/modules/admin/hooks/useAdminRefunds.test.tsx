import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminRefundListQueryKey } from './admin-query-keys';
import { useAdminRefunds } from './useAdminRefunds';

vi.mock('../services/admin.service', () => ({
  listRefunds: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAdminRefunds', () => {
  beforeEach(() => {
    vi.mocked(adminService.listRefunds).mockReset();
  });

  it('gọi service với status/page, lưu dưới key riêng của từng bộ lọc/trang', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 };
    vi.mocked(adminService.listRefunds).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { status: 'FAILED' as const, page: 2 };

    const { result } = renderHook(() => useAdminRefunds(query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.listRefunds).toHaveBeenCalledWith(query);
    expect(queryClient.getQueryData(adminRefundListQueryKey(query))).toEqual(page);
    expect(
      queryClient.getQueryData(adminRefundListQueryKey({ status: 'SUCCEEDED', page: 2 })),
    ).toBeUndefined();
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.listRefunds).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminRefunds(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.listRefunds).toHaveBeenCalledTimes(1);
    },
  );
});
