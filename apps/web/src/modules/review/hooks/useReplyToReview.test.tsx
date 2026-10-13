import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as reviewService from '../services/review.service';
import { sellerReviewListQueryKey } from './review-query-keys';
import { useReplyToReview } from './useReplyToReview';

vi.mock('../services/review.service', () => ({
  replyToReview: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

describe('useReplyToReview', () => {
  beforeEach(() => {
    vi.mocked(reviewService.replyToReview).mockReset();
  });

  it('shopId lấy lúc khai hook, reviewId truyền lúc mutate: service nhận (shopId, reviewId, { reply })', async () => {
    vi.mocked(reviewService.replyToReview).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useReplyToReview('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ reviewId: 'review-1', reply: 'Cảm ơn bạn!' }));

    expect(reviewService.replyToReview).toHaveBeenCalledWith('shop-1', 'review-1', {
      reply: 'Cảm ơn bạn!',
    });
  });

  it('thành công -> làm mới MỌI danh sách đánh giá của đúng shop đó (đánh giá vừa đổi tab)', async () => {
    vi.mocked(reviewService.replyToReview).mockResolvedValue({} as never);
    const { queryClient, wrapper, invalidate } = setup();
    queryClient.setQueryData(sellerReviewListQueryKey('shop-1', { replied: 'false' }), {});
    queryClient.setQueryData(sellerReviewListQueryKey('shop-2', { replied: 'false' }), {});
    const { result } = renderHook(() => useReplyToReview('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ reviewId: 'review-1', reply: 'Cảm ơn!' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reviews', 'seller', 'shop-1', 'list'] });
    expect(
      queryClient.getQueryState(sellerReviewListQueryKey('shop-1', { replied: 'false' }))
        ?.isInvalidated,
    ).toBe(true);
    // Shop khác không bị đụng tới.
    expect(
      queryClient.getQueryState(sellerReviewListQueryKey('shop-2', { replied: 'false' }))
        ?.isInvalidated,
    ).toBe(false);
  });

  it('lỗi (vd 404 đánh giá không còn) -> ném lại và VẪN làm mới danh sách (đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(reviewService.replyToReview).mockRejectedValue(error);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useReplyToReview('shop-1'), { wrapper });

    // `act` bất đồng bộ + try/catch thay vì `expect(act(...)).rejects`: mẫu sau làm `act` ném lỗi TRƯỚC
    // khi `onError` kịp chạy (test thấy 0 lần gọi dù hook đúng).
    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ reviewId: 'review-1', reply: 'x' });
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reviews', 'seller', 'shop-1', 'list'] });
  });
});
