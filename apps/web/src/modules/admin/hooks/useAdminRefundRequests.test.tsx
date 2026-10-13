import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminRefundRequestListQueryKey } from './admin-query-keys';
import { useAdminRefundRequests } from './useAdminRefundRequests';

vi.mock('../services/admin.service', () => ({
  listRefundRequests: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAdminRefundRequests', () => {
  beforeEach(() => {
    vi.mocked(adminService.listRefundRequests).mockReset();
  });

  it('gọi service với status/page, lưu dưới key riêng của từng tab/trang', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 };
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();
    const query = { status: 'ESCALATED' as const, page: 2 };

    const { result } = renderHook(() => useAdminRefundRequests(query), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.listRefundRequests).toHaveBeenCalledWith(query);
    expect(queryClient.getQueryData(adminRefundRequestListQueryKey(query))).toEqual(page);
    expect(
      queryClient.getQueryData(
        adminRefundRequestListQueryKey({ status: 'PENDING_SELLER', page: 2 }),
      ),
    ).toBeUndefined();
  });

  it('không truyền bộ lọc -> gọi service với {} (BE tự áp default ESCALATED)', async () => {
    vi.mocked(adminService.listRefundRequests).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => useAdminRefundRequests(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(adminService.listRefundRequests).toHaveBeenCalledWith({});
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.listRefundRequests).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminRefundRequests(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.listRefundRequests).toHaveBeenCalledTimes(1);
    },
  );
});
