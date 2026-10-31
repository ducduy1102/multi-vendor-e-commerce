import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { useRestoreProduct } from './useRestoreProduct';

vi.mock('../services/admin.service', () => ({ restoreProduct: vi.fn() }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe('useRestoreProduct', () => {
  beforeEach(() => {
    vi.mocked(adminService.restoreProduct).mockReset();
  });

  it('gọi service với ID SẢN PHẨM và lý do (id không lẫn vào body)', async () => {
    vi.mocked(adminService.restoreProduct).mockResolvedValue({
      product: { id: 'p-1', status: 'DRAFT', takenDownAt: null },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRestoreProduct(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ productId: 'p-1', reason: 'Đã xét lại' });
    });

    expect(adminService.restoreProduct).toHaveBeenCalledWith('p-1', { reason: 'Đã xét lại' });
  });

  it('lỗi 409 PRODUCT_NOT_TAKEN_DOWN được ném ra cho nơi gọi dịch', async () => {
    vi.mocked(adminService.restoreProduct).mockRejectedValue(
      new ApiError('This product is not taken down', 409, 'PRODUCT_NOT_TAKEN_DOWN'),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useRestoreProduct(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ productId: 'p-1', reason: 'x' });
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_TAKEN_DOWN' });
  });
});
