import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as reviewService from '../services/review.service';
import { useCreateReview } from './useCreateReview';

vi.mock('../services/review.service', () => ({
  createReview: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

const INPUT = { orderId: 'order-1', productId: 'product-1', rating: 5, comment: 'Tốt' };

describe('useCreateReview', () => {
  beforeEach(() => {
    vi.mocked(reviewService.createReview).mockReset();
  });

  it('truyền nguyên input cho service và trả đánh giá vừa tạo', async () => {
    const created = { id: 'review-1', rating: 5 } as never;
    vi.mocked(reviewService.createReview).mockResolvedValue(created);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateReview(), { wrapper });

    const review = await act(() => result.current.mutateAsync(INPUT));

    expect(reviewService.createReview).toHaveBeenCalledWith(INPUT);
    expect(review).toBe(created);
  });

  it('không truyền onSettled vẫn chạy bình thường (module review không tự đụng cache của order)', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateReview(), { wrapper });

    await act(() => result.current.mutateAsync(INPUT));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('thành công -> gọi onSettled đúng 1 lần để nơi dùng làm mới cache của nó', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const onSettled = vi.fn();
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateReview({ onSettled }), { wrapper });

    await act(() => result.current.mutateAsync(INPUT));

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('lỗi (vd 409 đã đánh giá ở tab khác) -> ném lại và VẪN gọi onSettled (cờ canReview đang hiển thị đã cũ)', async () => {
    const error = new Error('boom');
    vi.mocked(reviewService.createReview).mockRejectedValue(error);
    const onSettled = vi.fn();
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateReview({ onSettled }), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(INPUT);
      } catch (caught) {
        rejection = caught;
      }
    });

    expect(rejection).toBe(error);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('dùng onSettled của lần render MỚI NHẤT (callback đổi theo state của nơi dùng)', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const first = vi.fn();
    const second = vi.fn();
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ onSettled }: { onSettled: () => void }) => useCreateReview({ onSettled }),
      { wrapper, initialProps: { onSettled: first } },
    );

    rerender({ onSettled: second });
    await act(() => result.current.mutateAsync(INPUT));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('useCreateReview — onSettled trả về Promise', () => {
  it('mutateAsync chỉ kết thúc SAU khi Promise của onSettled xong (cache đã làm mới trước khi nơi dùng đóng form)', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const order: string[] = [];
    const onSettled = vi.fn(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('refreshed');
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateReview({ onSettled }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(INPUT);
      order.push('after-mutateAsync');
    });

    expect(order).toEqual(['refreshed', 'after-mutateAsync']);
  });
});
