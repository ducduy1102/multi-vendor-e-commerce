import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as reviewService from '../services/review.service';
import type { SellerReview } from '../types';
import { SellerReviewItem } from './SellerReviewItem';

vi.mock('../services/review.service', () => ({
  replyToReview: vi.fn(),
}));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const SHOP = 'shop-1';

function review(overrides: Partial<SellerReview> = {}): SellerReview {
  return {
    id: 'review-1',
    rating: 4,
    comment: 'Áo đẹp, giao nhanh',
    createdAt: '2026-10-01T05:00:00.000Z',
    editedAt: null,
    reviewerName: 'N***',
    sellerReply: null,
    sellerRepliedAt: null,
    product: { id: 'product-9', name: 'Áo thun cổ tròn', slug: 'ao-thun-co-tron' },
    ...overrides,
  };
}

function setup(overrides: Partial<SellerReview> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <ul>
          <SellerReviewItem review={review(overrides)} shopId={SHOP} />
        </ul>
      </QueryClientProvider>,
    ),
  );
}

describe('SellerReviewItem — hiển thị', () => {
  beforeEach(() => {
    vi.mocked(reviewService.replyToReview).mockReset();
    toastSuccess.mockReset();
  });

  it('có sao, tên đã che, nội dung đánh giá (dựng trên ReviewItem dùng chung với trang sản phẩm)', () => {
    setup();

    expect(screen.getByRole('img', { name: '4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('N***')).toBeInTheDocument();
    expect(screen.getByText('Áo đẹp, giao nhanh')).toBeInTheDocument();
  });

  it('dòng sản phẩm là link tới trang SỬA sản phẩm của shop (luôn mở được, kể cả sản phẩm đã lưu trữ)', () => {
    setup();

    expect(screen.getByRole('link', { name: 'Áo thun cổ tròn' })).toHaveAttribute(
      'href',
      '/seller/products/product-9/edit',
    );
  });

  it('chưa trả lời: có nút "Trả lời", không có khối phản hồi', () => {
    setup();

    expect(screen.getByRole('button', { name: 'Trả lời' })).toBeInTheDocument();
    expect(screen.queryByText('Phản hồi của shop')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa câu trả lời' })).not.toBeInTheDocument();
  });

  it('đã trả lời: hiện câu trả lời hiện có + nút "Sửa câu trả lời" (không có nút xoá)', () => {
    setup({ sellerReply: 'Cảm ơn bạn!', sellerRepliedAt: '2026-10-02T05:00:00.000Z' });

    expect(screen.getByText('Phản hồi của shop')).toBeInTheDocument();
    expect(screen.getByText('Cảm ơn bạn!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sửa câu trả lời' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trả lời' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /xoá|xóa|delete/i })).not.toBeInTheDocument();
  });

  it('tên sản phẩm và nội dung 500 ký tự liền không dấu cách: ngắt được chữ, không đẩy trang rộng ra', () => {
    setup({
      comment: 'a'.repeat(500),
      product: { id: 'product-9', name: 'P'.repeat(300), slug: 'p' },
    });

    expect(screen.getByRole('link', { name: 'P'.repeat(300) })).toHaveClass('break-words');
    expect(screen.getByText('a'.repeat(500))).toHaveClass('break-words');
  });
});

describe('SellerReviewItem — trả lời', () => {
  beforeEach(() => {
    vi.mocked(reviewService.replyToReview).mockReset();
    toastSuccess.mockReset();
  });

  it('bấm "Trả lời" mở form tại chỗ (nút chuyển thành form), "Huỷ" đóng lại không gọi API', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(screen.getByLabelText('Câu trả lời của shop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trả lời' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByLabelText('Câu trả lời của shop')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trả lời' })).toBeInTheDocument();
    expect(reviewService.replyToReview).not.toHaveBeenCalled();
  });

  it('gửi lần đầu -> gọi service đúng (shopId, reviewId, { reply }), toast "Đã gửi câu trả lời", đóng form', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.replyToReview).mockResolvedValue({} as never);
    setup();

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    await user.type(screen.getByLabelText('Câu trả lời của shop'), 'Cảm ơn bạn đã ủng hộ');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    await waitFor(() =>
      expect(reviewService.replyToReview).toHaveBeenCalledWith(SHOP, 'review-1', {
        reply: 'Cảm ơn bạn đã ủng hộ',
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã gửi câu trả lời'));
    await waitFor(() =>
      expect(screen.queryByLabelText('Câu trả lời của shop')).not.toBeInTheDocument(),
    );
  });

  it('sửa lại -> form điền sẵn câu cũ, gửi gọi cùng service, toast "Đã cập nhật câu trả lời"', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.replyToReview).mockResolvedValue({} as never);
    setup({ sellerReply: 'Cảm ơn bạn!', sellerRepliedAt: '2026-10-02T05:00:00.000Z' });

    await user.click(screen.getByRole('button', { name: 'Sửa câu trả lời' }));
    const field = screen.getByLabelText('Câu trả lời của shop');
    expect(field).toHaveValue('Cảm ơn bạn!');
    await user.clear(field);
    await user.type(field, 'Shop xin lỗi vì sự bất tiện');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() =>
      expect(reviewService.replyToReview).toHaveBeenCalledWith(SHOP, 'review-1', {
        reply: 'Shop xin lỗi vì sự bất tiện',
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã cập nhật câu trả lời'));
  });

  it('lỗi có mã nghiệp vụ -> thông báo đã dịch ngay trong form, form GIỮ MỞ với nội dung đã gõ, không toast thành công', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.replyToReview).mockRejectedValue(
      new ApiError('x', 404, 'REVIEW_NOT_FOUND'),
    );
    setup();

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    await user.type(screen.getByLabelText('Câu trả lời của shop'), 'Cảm ơn');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Câu trả lời của shop')).toHaveValue('Cảm ơn');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('lỗi không rõ (mất mạng) -> câu chung, không lộ message gốc', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.replyToReview).mockRejectedValue(new Error('boom: stack trace'));
    setup();

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    await user.type(screen.getByLabelText('Câu trả lời của shop'), 'Cảm ơn');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không thực hiện được thao tác, vui lòng thử lại');
    expect(alert).not.toHaveTextContent('boom');
  });

  it('mở lại form sau lỗi -> lỗi cũ được xoá', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.replyToReview).mockRejectedValue(new Error('x'));
    setup();

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    await user.type(screen.getByLabelText('Câu trả lời của shop'), 'Cảm ơn');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    await user.click(screen.getByRole('button', { name: 'Trả lời' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
