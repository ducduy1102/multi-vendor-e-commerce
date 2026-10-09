import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as reviewService from '../services/review.service';
import { useUpdateReview } from './useUpdateReview';

vi.mock('../services/review.service', () => ({
  updateReview: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe('useUpdateReview', () => {
  beforeEach(() => {
    vi.mocked(reviewService.updateReview).mockReset();
  });

  it('reviewId truyền lúc mutate, tách khỏi body: service nhận (reviewId, { rating, comment })', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateReview(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ reviewId: 'review-1', rating: 4, comment: 'Cũng ổn' }),
    );

    expect(reviewService.updateReview).toHaveBeenCalledWith('review-1', {
      rating: 4,
      comment: 'Cũng ổn',
    });
  });

  it('thành công -> gọi onSettled đúng 1 lần', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue({} as never);
    const onSettled = vi.fn();
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateReview({ onSettled }), { wrapper });

    await act(() => result.current.mutateAsync({ reviewId: 'review-1', rating: 3 }));

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('lỗi (vd 409 đã sửa một lần) -> ném lại và VẪN gọi onSettled (cờ canEdit đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(reviewService.updateReview).mockRejectedValue(error);
    const onSettled = vi.fn();
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateReview({ onSettled }), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ reviewId: 'review-1', rating: 3 });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe('useUpdateReview — onSettled trả về Promise', () => {
  it('mutateAsync chỉ kết thúc SAU khi Promise của onSettled xong', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue({} as never);
    const order: string[] = [];
    const onSettled = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('refreshed');
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateReview({ onSettled }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ reviewId: 'review-1', rating: 4 });
      order.push('after-mutateAsync');
    });

    expect(order).toEqual(['refreshed', 'after-mutateAsync']);
  });
});
