import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { adminRefundablePaymentListQueryKey } from './admin-query-keys';
import { useAdminRefundablePayments } from './useAdminRefundablePayments';

vi.mock('../services/admin.service', () => ({
  listRefundablePayments: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAdminRefundablePayments', () => {
  beforeEach(() => {
    vi.mocked(adminService.listRefundablePayments).mockReset();
  });

  it('gọi service với page, lưu dưới key riêng của từng trang', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 };
    vi.mocked(adminService.listRefundablePayments).mockResolvedValue(page);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useAdminRefundablePayments({ page: 2 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminService.listRefundablePayments).toHaveBeenCalledWith({ page: 2 });
    expect(queryClient.getQueryData(adminRefundablePaymentListQueryKey({ page: 2 }))).toEqual(page);
    expect(
      queryClient.getQueryData(adminRefundablePaymentListQueryKey({ page: 1 })),
    ).toBeUndefined();
  });

  it.each([401, 403])(
    '%i (chưa đăng nhập/không phải ADMIN) -> báo lỗi ngay, không thử lại',
    async (status) => {
      vi.mocked(adminService.listRefundablePayments).mockRejectedValue(new ApiError('x', status));
      const { wrapper } = setup();

      const { result } = renderHook(() => useAdminRefundablePayments(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(adminService.listRefundablePayments).toHaveBeenCalledTimes(1);
    },
  );
});
