import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as adminService from '../services/admin.service';
import { useUnhideReview } from './useUnhideReview';

vi.mock('../services/admin.service', () => ({ unhideReview: vi.fn() }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe('useUnhideReview', () => {
  beforeEach(() => {
    vi.mocked(adminService.unhideReview).mockReset();
  });

  it('gọi service với ID ĐÁNH GIÁ và lý do (id không lẫn vào body)', async () => {
    vi.mocked(adminService.unhideReview).mockResolvedValue({
      review: { id: 'rv-1', isHidden: false, hiddenAt: null },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUnhideReview(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ reviewId: 'rv-1', reason: 'Đã xét lại' });
    });

    expect(adminService.unhideReview).toHaveBeenCalledWith('rv-1', { reason: 'Đã xét lại' });
  });

  it('lỗi 409 REVIEW_NOT_HIDDEN được ném ra cho nơi gọi dịch', async () => {
    vi.mocked(adminService.unhideReview).mockRejectedValue(
      new ApiError('This review is not hidden', 409, 'REVIEW_NOT_HIDDEN'),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useUnhideReview(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ reviewId: 'rv-1', reason: 'x' });
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_HIDDEN' });
  });
});
