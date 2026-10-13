import { render, screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';
import messages from '../../../../messages/vi.json';
import * as reviewService from '../services/review.service';
import type { ProductReviewsResponse, Review } from '../types';
import { ProductReviewList } from './ProductReviewList';

vi.mock('../services/review.service', () => ({
  listProductReviews: vi.fn(),
}));

// ProductReviewList là Server Component async dùng getTranslations (next-intl/server cần ngữ cảnh request) —
// thay bằng translator thật dựng từ messages vi để test vẫn kiểm đúng bản dịch hiển thị.
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) =>
    Promise.resolve(createTranslator({ locale: 'vi', messages, namespace: namespace as 'review' })),
}));

function review(id: string, overrides: Partial<Review> = {}): Review {
  return {
    id,
    rating: 5,
    comment: `Nhận xét ${id}`,
    createdAt: '2026-10-01T05:00:00.000Z',
    editedAt: null,
    reviewerName: 'N***',
    sellerReply: null,
    sellerRepliedAt: null,
    ...overrides,
  };
}

const SUMMARY = {
  avgRating: 4.5,
  reviewCount: 12,
  distribution: { '1': 0, '2': 1, '3': 1, '4': 3, '5': 7 },
};

function response(overrides: Partial<ProductReviewsResponse> = {}): ProductReviewsResponse {
  return {
    summary: SUMMARY,
    items: [review('r1'), review('r2', { sellerReply: 'Cảm ơn bạn!' })],
    total: 12,
    page: 1,
    limit: 10,
    ...overrides,
  };
}

async function renderList(query: { rating?: number; page?: number } = {}) {
  const ui = await ProductReviewList({
    productSlug: 'ao-thun',
    query: { rating: query.rating, page: query.page ?? 1 },
  });
  return render(withIntl(ui));
}

describe('ProductReviewList', () => {
  beforeEach(() => {
    vi.mocked(reviewService.listProductReviews).mockReset();
  });

  it('gọi API theo slug với bộ lọc sao + trang đã parse', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(response());

    await renderList({ rating: 4, page: 2 });

    expect(reviewService.listProductReviews).toHaveBeenCalledWith('ao-thun', {
      rating: 4,
      page: 2,
    });
  });

  it('có đánh giá: tiêu đề h2, tóm tắt, danh sách và trả lời của shop, neo id="reviews"', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(response());

    const { container } = await renderList();

    const section = container.querySelector('section#reviews');
    expect(section).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Đánh giá sản phẩm' }),
    ).toBeInTheDocument();
    expect(section).toHaveAttribute('aria-labelledby', 'reviews-heading');
    expect(screen.getByText('12 đánh giá')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Nhận xét r1')).toBeInTheDocument();
    expect(screen.getByText('Cảm ơn bạn!')).toBeInTheDocument();
  });

  it('chừa chỗ cho header dính khi cuộn tới neo #reviews (scroll-mt-28 ≥ 97px của header mobile)', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(response());

    const { container } = await renderList();

    // Hồi quy từ trình duyệt thật: scroll-mt-4 cũ để header dính che tiêu đề khi bấm lọc/chuyển trang
    // (jsdom không có layout nên chỉ giữ được lớp class).
    expect(container.querySelector('section#reviews')).toHaveClass('scroll-mt-28');
  });

  it('chưa có đánh giá nào: chỉ hiện thông báo rỗng, không có tóm tắt/phân trang', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(
      response({
        summary: {
          avgRating: 0,
          reviewCount: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
        items: [],
        total: 0,
      }),
    );

    await renderList();

    expect(screen.getByText('Sản phẩm này chưa có đánh giá nào.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lỗi API: hiện thông báo trong khối, KHÔNG ném lỗi, KHÔNG lộ message của BE', async () => {
    vi.mocked(reviewService.listProductReviews).mockRejectedValue(
      new ApiError('internal: connection refused', 500),
    );

    const { container } = await renderList();

    expect(screen.getByRole('heading', { name: 'Đánh giá sản phẩm' })).toBeInTheDocument();
    expect(screen.getByText('Không tải được đánh giá, vui lòng thử lại sau.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('connection refused');
    expect(container.querySelector('section#reviews')).toBeInTheDocument();
  });

  it('đang lọc theo sao: có dòng "Đang xem đánh giá N sao" kèm liên kết "Xem tất cả" về URL không lọc', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(
      response({ items: [review('r1', { rating: 4 })], total: 3 }),
    );

    await renderList({ rating: 4 });

    expect(screen.getByText(/Đang xem đánh giá 4 sao/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem tất cả' })).toHaveAttribute(
      'href',
      '/products/ao-thun#reviews',
    );
  });

  it('lọc ra 0 đánh giá (sản phẩm vẫn có đánh giá mức khác): giữ tóm tắt để đổi mức, báo "Chưa có đánh giá N sao"', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(
      response({ items: [], total: 0 }),
    );

    await renderList({ rating: 1 });

    expect(screen.getByText('Chưa có đánh giá 1 sao nào.')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Lọc đánh giá theo số sao' }),
    ).toBeInTheDocument();
  });

  it('nhiều trang: phân trang Trước/Sau giữ nguyên bộ lọc sao, kèm neo #reviews', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(
      response({ page: 2, total: 25, limit: 10, items: [review('r11')] }),
    );

    await renderList({ rating: 5, page: 2 });

    const pagination = screen.getByRole('navigation', { name: 'Phân trang đánh giá' });
    expect(within(pagination).getByText('Trang 2/3')).toBeInTheDocument();
    expect(within(pagination).getByRole('link', { name: 'Trước' })).toHaveAttribute(
      'href',
      '/products/ao-thun?reviewRating=5#reviews',
    );
    expect(within(pagination).getByRole('link', { name: 'Sau' })).toHaveAttribute(
      'href',
      '/products/ao-thun?reviewRating=5&reviewPage=3#reviews',
    );
  });

  it('một trang duy nhất: không hiện phân trang', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(response({ total: 2 }));

    await renderList();

    expect(
      screen.queryByRole('navigation', { name: 'Phân trang đánh giá' }),
    ).not.toBeInTheDocument();
  });

  it('URL gõ tay vượt số trang (reviewPage=99): báo trang trống và nút Trước kẹp về trang cuối thật', async () => {
    vi.mocked(reviewService.listProductReviews).mockResolvedValue(
      response({ items: [], page: 99, total: 25, limit: 10 }),
    );

    await renderList({ page: 99 });

    expect(screen.getByText('Không có đánh giá nào ở trang này.')).toBeInTheDocument();
    const pagination = screen.getByRole('navigation', { name: 'Phân trang đánh giá' });
    expect(within(pagination).getByRole('link', { name: 'Trước' })).toHaveAttribute(
      'href',
      '/products/ao-thun?reviewPage=3#reviews',
    );
  });
});
