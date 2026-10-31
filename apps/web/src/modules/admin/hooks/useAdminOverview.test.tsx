import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminOverviewQueryKey } from './admin-query-keys';
import { useAdminOverview } from './useAdminOverview';

vi.mock('../services/admin.service', () => ({
  getOverview: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const OVERVIEW = {
  pendingShops: 3,
  escalatedRefundRequests: 1,
  refundsNeedingAction: 0,
  refundablePayments: 12,
  openReports: 4,
};

describe('useAdminOverview', () => {
  beforeEach(() => {
    vi.mocked(adminService.getOverview).mockReset();
  });

  it('gọi service và lưu dưới key riêng của tổng quan', async () => {
    vi.mocked(adminService.getOverview).mockResolvedValue(OVERVIEW);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useAdminOverview(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(OVERVIEW);
    expect(queryClient.getQueryData(adminOverviewQueryKey())).toEqual(OVERVIEW);
  });

  it('nav và trang tổng quan dùng chung một query: hai nơi gọi hook cùng lúc chỉ gọi API MỘT lần', async () => {
    vi.mocked(adminService.getOverview).mockResolvedValue(OVERVIEW);
    const { wrapper } = setup();

    const { result } = renderHook(() => [useAdminOverview(), useAdminOverview()] as const, {
      wrapper,
    });

    await waitFor(() => expect(result.current[0].isSuccess).toBe(true));
    expect(result.current[1].data).toEqual(OVERVIEW);
    expect(adminService.getOverview).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.getOverview).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminOverview(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.getOverview).toHaveBeenCalledTimes(1);
    },
  );
});
