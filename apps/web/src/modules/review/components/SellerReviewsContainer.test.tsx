import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as reviewService from '../services/review.service';
import type { SellerReviewsPageQuery } from '../seller-reviews-query';
import type { SellerReview, SellerReviewListResponse } from '../types';
import { SellerReviewsContainer } from './SellerReviewsContainer';

vi.mock('../services/review.service', () => ({
  listShopReviews: vi.fn(),
  replyToReview: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SHOP = 'shop-1';
const ALL: SellerReviewsPageQuery = { replied: undefined, rating: undefined, page: 1 };

function review(id: string, overrides: Partial<SellerReview> = {}): SellerReview {
  return {
    id,
    rating: 4,
    comment: `Nội dung ${id}`,
    createdAt: '2026-10-01T05:00:00.000Z',
    editedAt: null,
    reviewerName: 'N***',
    sellerReply: null,
    sellerRepliedAt: null,
    product: { id: 'product-9', name: 'Áo thun cổ tròn', slug: 'ao-thun-co-tron' },
    ...overrides,
  };
}

const page = (items: SellerReview[], total = items.length): SellerReviewListResponse => ({
  items,
  total,
  page: 1,
  limit: 10,
});

function setup(query: Partial<SellerReviewsPageQuery> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <SellerReviewsContainer shopId={SHOP} query={{ ...ALL, ...query }} />
      </QueryClientProvider>,
    ),
  );
}

describe('SellerReviewsContainer', () => {
  beforeEach(() => {
    vi.mocked(reviewService.listShopReviews).mockReset();
    vi.mocked(reviewService.replyToReview).mockReset();
  });

  it('đang tải: vùng aria-busy kèm dòng sr-only, skeleton trang trí; tiêu đề và bộ lọc vẫn hiện', () => {
    vi.mocked(reviewService.listShopReviews).mockReturnValue(new Promise(() => undefined));
    const { container } = setup();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Đánh giá của khách hàng' })).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Lọc đánh giá theo trạng thái trả lời' }),
    ).toBeInTheDocument();
  });

  it('lỗi tải lần đầu: thông báo role=alert + nút "Thử lại" tải lại được', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewService.listShopReviews)
      .mockRejectedValueOnce(new ApiError('Forbidden', 403))
      .mockResolvedValue(page([review('review-1')]));
    setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được đánh giá của shop');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Nội dung review-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shop chưa có đánh giá nào (không lọc): câu riêng, không có danh sách', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page([]));
    setup();

    expect(await screen.findByText('Shop chưa có đánh giá nào.')).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Danh sách đánh giá của shop' }),
    ).not.toBeInTheDocument();
  });

  it('đang lọc mà không có kết quả: câu "không khớp bộ lọc" (khác câu của shop chưa có đánh giá)', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page([]));
    setup({ replied: 'false' });

    expect(await screen.findByText('Không có đánh giá nào khớp bộ lọc.')).toBeInTheDocument();
    expect(screen.queryByText('Shop chưa có đánh giá nào.')).not.toBeInTheDocument();
  });

  it('trang vượt quá trang cuối (rỗng nhưng total > 0): câu "không có đánh giá ở trang này"', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue({ ...page([], 12), page: 5 });
    setup({ page: 5 });

    expect(await screen.findByText('Không có đánh giá nào ở trang này.')).toBeInTheDocument();
  });

  it('có đánh giá: tổng số, danh sách, mỗi mục có nút trả lời hoặc sửa theo đúng trạng thái', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(
      page([
        review('review-1'),
        review('review-2', { sellerReply: 'Cảm ơn!', sellerRepliedAt: '2026-10-02T05:00:00.000Z' }),
      ]),
    );
    setup();

    const list = await screen.findByRole('list', { name: 'Danh sách đánh giá của shop' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText('2 đánh giá')).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Trả lời' })).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Sửa câu trả lời' })).toBeInTheDocument();
  });

  it.each([
    [{}, { replied: undefined, rating: undefined, page: 1 }],
    [{ replied: 'false' as const }, { replied: 'false', rating: undefined, page: 1 }],
    [
      { rating: 2, page: 3 },
      { replied: undefined, rating: 2, page: 3 },
    ],
  ])('truy vấn %j -> gọi service với đúng bộ lọc + trang', async (query, expected) => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page([]));
    setup(query);

    await waitFor(() => expect(reviewService.listShopReviews).toHaveBeenCalledWith(SHOP, expected));
  });

  it('nhiều trang: có phân trang, "Trang sau" giữ nguyên bộ lọc', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page([review('review-1')], 25));
    setup({ replied: 'false', rating: 5 });

    expect(await screen.findByText('Trang 1/3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sau' })).toHaveAttribute(
      'href',
      '/seller/reviews?replied=false&rating=5&page=2',
    );
  });

  it('một trang duy nhất: không hiện phân trang', async () => {
    vi.mocked(reviewService.listShopReviews).mockResolvedValue(page([review('review-1')]));
    setup();

    await screen.findByText('Nội dung review-1');
    expect(
      screen.queryByRole('navigation', { name: 'Phân trang đánh giá' }),
    ).not.toBeInTheDocument();
  });
});
