import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminService from '../services/admin.service';
import { useUpdateShopStatus } from './useUpdateShopStatus';

vi.mock('../services/admin.service', () => ({
  updateShopStatus: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useUpdateShopStatus', () => {
  beforeEach(() => {
    vi.mocked(adminService.updateShopStatus).mockReset();
  });

  it('shopId truyền lúc mutate, tách khỏi body: service nhận (shopId, {status, reason})', async () => {
    vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateShopStatus(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ shopId: 'shop-1', status: 'SUSPENDED', reason: 'Hàng cấm' }),
    );

    expect(adminService.updateShopStatus).toHaveBeenCalledWith('shop-1', {
      status: 'SUSPENDED',
      reason: 'Hàng cấm',
    });
  });

  it('duyệt (không lý do) -> body không có field reason', async () => {
    vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateShopStatus(), { wrapper });

    await act(() => result.current.mutateAsync({ shopId: 'shop-1', status: 'APPROVED' }));

    expect(adminService.updateShopStatus).toHaveBeenCalledWith('shop-1', { status: 'APPROVED' });
  });

  it('thành công -> làm mới MỌI danh sách shop (shop vừa rời tab hiện tại)', async () => {
    vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateShopStatus(), { wrapper });

    await act(() => result.current.mutateAsync({ shopId: 'shop-1', status: 'APPROVED' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'shops', 'list'] });
  });

  it('lỗi (vd 409 Admin khác vừa xử lý) -> ném lại và VẪN làm mới danh sách (đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(adminService.updateShopStatus).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateShopStatus(), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(() => mutateAsync())).rejects`: mẫu sau làm
    // `act` ném lỗi TRƯỚC khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ shopId: 'shop-1', status: 'APPROVED' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'shops', 'list'] });
  });
});
