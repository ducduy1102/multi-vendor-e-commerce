import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import {
  adminRefundListQueryKey,
  adminRefundRequestListQueryKey,
  adminRefundablePaymentListQueryKey,
} from './admin-query-keys';
import { useDecideRefundRequest } from './useDecideRefundRequest';

vi.mock('../services/admin.service', () => ({
  decideRefundRequest: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useDecideRefundRequest', () => {
  beforeEach(() => {
    vi.mocked(adminService.decideRefundRequest).mockReset();
  });

  it('requestId truyền lúc mutate, tách khỏi body: service nhận (requestId, {decision, note})', async () => {
    vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useDecideRefundRequest(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ requestId: 'r1', decision: 'REJECT', note: 'Không hợp lệ' }),
    );

    expect(adminService.decideRefundRequest).toHaveBeenCalledWith('r1', {
      decision: 'REJECT',
      note: 'Không hợp lệ',
    });
  });

  it('duyệt (không ghi chú) -> body không có field note', async () => {
    vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useDecideRefundRequest(), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1', decision: 'APPROVE' }));

    expect(adminService.decideRefundRequest).toHaveBeenCalledWith('r1', { decision: 'APPROVE' });
  });

  it('thành công -> làm mới hàng chờ VÀ sổ cái (duyệt có thể tạo khoản hoàn mới), không đụng danh sách thanh toán bất thường', async () => {
    vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(adminRefundRequestListQueryKey({ status: 'ESCALATED' }), {});
    queryClient.setQueryData(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }), {});
    queryClient.setQueryData(adminRefundablePaymentListQueryKey({}), {});
    const { result } = renderHook(() => useDecideRefundRequest(), { wrapper });

    await act(() => result.current.mutateAsync({ requestId: 'r1', decision: 'APPROVE' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refund-requests', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
    expect(
      queryClient.getQueryState(adminRefundRequestListQueryKey({ status: 'ESCALATED' }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(adminRefundListQueryKey({ status: 'NEEDS_ACTION' }))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(adminRefundablePaymentListQueryKey({}))?.isInvalidated).toBe(
      false,
    );
  });

  it('lỗi (vd 409 Admin khác vừa xử lý) -> ném lại và VẪN làm mới hàng chờ + sổ cái (đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(adminService.decideRefundRequest).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useDecideRefundRequest(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (note-nextjs.md #37).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ requestId: 'r1', decision: 'APPROVE' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refund-requests', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'refunds', 'list'] });
  });
});
