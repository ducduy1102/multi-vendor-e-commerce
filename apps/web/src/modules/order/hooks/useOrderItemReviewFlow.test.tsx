import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as reviewService from '@/modules/review/services/review.service';
import { orderQueryKey } from './order-query-keys';
import { useOrderItemReviewFlow, type ReviewTargetItem } from './useOrderItemReviewFlow';

vi.mock('@/modules/review/services/review.service', () => ({
  createReview: vi.fn(),
  updateReview: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const ITEM: ReviewTargetItem = {
  productId: 'product-1',
  productName: 'Áo thun nam',
  review: null,
};
const REVIEWED: ReviewTargetItem = {
  ...ITEM,
  review: { id: 'review-1', rating: 3, comment: 'Tạm ổn', editedAt: null, canEdit: true },
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  const hook = renderHook(() => useOrderItemReviewFlow('order-1'), { wrapper });
  return { ...hook, invalidate };
}

describe('useOrderItemReviewFlow', () => {
  beforeEach(() => {
    vi.mocked(reviewService.createReview).mockReset();
    vi.mocked(reviewService.updateReview).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it('ban đầu: ngăn kéo đóng, chế độ viết mới, không lỗi, không đang gửi', () => {
    const { result } = setup();

    expect(result.current.sheet).toMatchObject({
      open: false,
      mode: 'create',
      productName: '',
      initialValues: undefined,
      isSubmitting: false,
      errorMessage: null,
    });
  });

  it('openWrite: mở ngăn kéo ở chế độ viết mới cho đúng dòng hàng, form trống', () => {
    const { result } = setup();

    act(() => result.current.openWrite(ITEM));

    expect(result.current.sheet).toMatchObject({
      open: true,
      mode: 'create',
      productName: 'Áo thun nam',
      initialValues: undefined,
    });
  });

  it('openEdit: chế độ sửa, điền sẵn sao + nhận xét cũ (nhận xét null thành undefined)', () => {
    const { result } = setup();

    act(() => result.current.openEdit(REVIEWED));
    expect(result.current.sheet).toMatchObject({
      open: true,
      mode: 'edit',
      initialValues: { rating: 3, comment: 'Tạm ổn' },
    });

    act(() => result.current.sheet.onOpenChange(false));
    act(() =>
      result.current.openEdit({ ...REVIEWED, review: { ...REVIEWED.review!, comment: null } }),
    );
    expect(result.current.sheet.initialValues).toEqual({ rating: 3, comment: undefined });
  });

  it('gửi đánh giá mới: gọi createReview với orderId + productId + giá trị form, làm mới cache chi tiết đơn, báo thành công và đóng', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const { result, invalidate } = setup();
    act(() => result.current.openWrite(ITEM));

    await act(async () => result.current.sheet.onSubmit({ rating: 5, comment: 'Rất tốt' }));

    expect(reviewService.createReview).toHaveBeenCalledWith({
      orderId: 'order-1',
      productId: 'product-1',
      rating: 5,
      comment: 'Rất tốt',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: orderQueryKey('order-1') });
    expect(toast.success).toHaveBeenCalledWith('Cảm ơn bạn đã đánh giá sản phẩm!');
    expect(result.current.sheet.open).toBe(false);
    expect(result.current.sheet.errorMessage).toBeNull();
  });

  it('sửa đánh giá: gọi updateReview theo id đánh giá cũ (không tạo mới), báo "đã cập nhật" và đóng', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue({} as never);
    const { result, invalidate } = setup();
    act(() => result.current.openEdit(REVIEWED));

    await act(async () => result.current.sheet.onSubmit({ rating: 4, comment: undefined }));

    expect(reviewService.updateReview).toHaveBeenCalledWith('review-1', {
      rating: 4,
      comment: undefined,
    });
    expect(reviewService.createReview).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: orderQueryKey('order-1') });
    expect(toast.success).toHaveBeenCalledWith('Đã cập nhật đánh giá của bạn');
    expect(result.current.sheet.open).toBe(false);
  });

  it('lỗi có mã (409 REVIEW_NOT_ALLOWED): giữ ngăn kéo mở, hiện câu đã dịch, KHÔNG báo thành công, vẫn làm mới cache (cờ đã cũ)', async () => {
    vi.mocked(reviewService.createReview).mockRejectedValue(
      new ApiError('English detail', 409, 'REVIEW_NOT_ALLOWED'),
    );
    const { result, invalidate } = setup();
    act(() => result.current.openWrite(ITEM));

    await act(async () => result.current.sheet.onSubmit({ rating: 5, comment: undefined }));

    expect(result.current.sheet.open).toBe(true);
    expect(result.current.sheet.errorMessage).toBe('Bạn chưa thể đánh giá sản phẩm này');
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: orderQueryKey('order-1') });
  });

  it('sửa lần hai (409 REVIEW_EDIT_NOT_ALLOWED) -> câu "chỉ được sửa một lần"; lỗi lạ/mất mạng -> câu chung, không lộ message gốc', async () => {
    vi.mocked(reviewService.updateReview).mockRejectedValueOnce(
      new ApiError('x', 409, 'REVIEW_EDIT_NOT_ALLOWED'),
    );
    const { result } = setup();
    act(() => result.current.openEdit(REVIEWED));
    await act(async () => result.current.sheet.onSubmit({ rating: 4, comment: undefined }));
    expect(result.current.sheet.errorMessage).toBe(
      'Đánh giá chỉ được sửa một lần và bạn đã sửa rồi',
    );

    vi.mocked(reviewService.updateReview).mockRejectedValueOnce(new Error('boom: stack trace'));
    await act(async () => result.current.sheet.onSubmit({ rating: 4, comment: undefined }));
    expect(result.current.sheet.errorMessage).toBe(
      'Không thực hiện được thao tác, vui lòng thử lại',
    );
  });

  it('mở lại sau một lần lỗi thì lỗi cũ được xoá', async () => {
    vi.mocked(reviewService.createReview).mockRejectedValue(new ApiError('x', 500));
    const { result } = setup();
    act(() => result.current.openWrite(ITEM));
    await act(async () => result.current.sheet.onSubmit({ rating: 5, comment: undefined }));
    expect(result.current.sheet.errorMessage).not.toBeNull();

    act(() => result.current.sheet.onOpenChange(false));
    act(() => result.current.openWrite(ITEM));

    expect(result.current.sheet.errorMessage).toBeNull();
  });

  it('đang gửi: isSubmitting bật và KHÔNG đóng được ngăn kéo (Esc/nền); gửi xong tự đóng', async () => {
    let resolveCreate: (value: never) => void = () => {};
    vi.mocked(reviewService.createReview).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve as (value: never) => void;
      }),
    );
    const { result } = setup();
    act(() => result.current.openWrite(ITEM));

    let submitting: Promise<void> = Promise.resolve();
    act(() => {
      submitting = Promise.resolve(
        result.current.sheet.onSubmit({ rating: 5, comment: undefined }),
      );
    });
    await vi.waitFor(() => expect(result.current.sheet.isSubmitting).toBe(true));

    act(() => result.current.sheet.onOpenChange(false));
    expect(result.current.sheet.open).toBe(true);

    await act(async () => {
      resolveCreate({} as never);
      await submitting;
    });
    await vi.waitFor(() => expect(result.current.sheet.open).toBe(false));
    expect(result.current.sheet.isSubmitting).toBe(false);
  });

  it('không đang gửi thì đóng được; nội dung (tên sản phẩm) giữ nguyên sau khi đóng để hiệu ứng đóng không đổi chữ', () => {
    const { result } = setup();
    act(() => result.current.openWrite(ITEM));

    act(() => result.current.sheet.onOpenChange(false));

    expect(result.current.sheet.open).toBe(false);
    expect(result.current.sheet.productName).toBe('Áo thun nam');
  });

  it('thành công chỉ đóng SAU khi cache chi tiết đơn đã làm mới xong (nút ở dòng hàng đổi trước khi ngăn kéo đóng)', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue({} as never);
    const { result, invalidate } = setup();
    let finishRefresh: () => void = () => {};
    invalidate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    act(() => result.current.openWrite(ITEM));

    let submitting: Promise<void> = Promise.resolve();
    act(() => {
      submitting = Promise.resolve(
        result.current.sheet.onSubmit({ rating: 5, comment: undefined }),
      );
    });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());

    // Cache chưa làm mới xong ⇒ vẫn mở, vẫn đang gửi, chưa báo thành công.
    expect(result.current.sheet.open).toBe(true);
    expect(result.current.sheet.isSubmitting).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      finishRefresh();
      await submitting;
    });

    await vi.waitFor(() => expect(result.current.sheet.open).toBe(false));
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
