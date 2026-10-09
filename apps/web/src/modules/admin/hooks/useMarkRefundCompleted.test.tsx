import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { adminRefundListQueryKey } from './admin-query-keys';
import { useMarkRefundCompleted } from './useMarkRefundCompleted';

vi.mock('../services/admin.service', () => ({
  markRefundCompleted: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useMarkRefundCompleted', () => {
  beforeEach(() => {
    vi.mocked(adminService.markRefundCompleted).mockReset();
  });

  it('refundId truyền lúc mutate, tách khỏi body: service nhận (refundId, { reference })', async () => {
    vi.mocked(adminService.markRefundCompleted).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkRefundCompleted(), { wrapper });

    await act(() => result.current.mutateAsync({ refundId: 'refund-1', reference: 'VNP-998' }));

    expect(adminService.markRefundCompleted).toHaveBeenCalledWith('refund-1', {
      reference: 'VNP-998',
    });
  });

  it('thành công -> làm mới MỌI danh sách sổ cái', async () => {
    vi.mocked(adminService.markRefundCompleted).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }), {});
    const { result } = renderHook(() => useMarkRefundCompleted(), { wrapper });

    await act(() => result.current.mutateAsync({ refundId: 'refund-1', reference: 'VNP-998' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
    expect(
      queryClient.getQueryState(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }))?.isInvalidated,
    ).toBe(true);
  });

  it('lỗi (vd 400 thiếu mã / 409 đã xử lý) -> ném lại và VẪN làm mới sổ cái', async () => {
    const error = new Error('boom');
    vi.mocked(adminService.markRefundCompleted).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useMarkRefundCompleted(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ refundId: 'refund-1', reference: 'x' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
  });
});
