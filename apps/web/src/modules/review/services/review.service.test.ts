import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createReview,
  listProductReviews,
  listShopReviews,
  replyToReview,
  updateReview,
} from './review.service';

const REVIEW = {
  id: 'review-1',
  rating: 5,
  comment: 'Áo đẹp, giao nhanh',
  createdAt: '2026-10-01T00:00:00.000Z',
  editedAt: null,
  reviewerName: 'N***',
  sellerReply: null,
  sellerRepliedAt: null,
};

const PRODUCT_REVIEWS = {
  summary: {
    avgRating: 4.5,
    reviewCount: 2,
    distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
  },
  items: [REVIEW],
  total: 2,
  page: 1,
  limit: 10,
};

const SELLER_REVIEW = {
  ...REVIEW,
  product: { id: 'product-1', name: 'Áo thun', slug: 'ao-thun' },
};

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function lastCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
}

describe('review.service — đọc công khai', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listProductReviews không tham số -> GET /products/:slug/reviews (không tự gửi default), parse đúng schema', async () => {
    mockFetchOnce({ success: true, data: PRODUCT_REVIEWS });

    const result = await listProductReviews('ao-thun');

    expect(result.summary.avgRating).toBe(4.5);
    expect(result.summary.distribution['5']).toBe(1);
    expect(result.items[0].reviewerName).toBe('N***');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/products\/ao-thun\/reviews$/);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('gửi rating/page/limit lên query string, bỏ qua field undefined', async () => {
    mockFetchOnce({ success: true, data: PRODUCT_REVIEWS });

    await listProductReviews('ao-thun', { rating: 4, page: 2, limit: 5 });
    expect(lastCall()[0]).toMatch(/\/products\/ao-thun\/reviews\?rating=4&page=2&limit=5$/);

    vi.unstubAllGlobals();
    mockFetchOnce({ success: true, data: PRODUCT_REVIEWS });
    await listProductReviews('ao-thun', { rating: undefined, page: 3 });
    expect(lastCall()[0]).toMatch(/\/products\/ao-thun\/reviews\?page=3$/);
  });

  it('mã hoá slug trên URL (slug lạ không phá đường dẫn)', async () => {
    mockFetchOnce({ success: true, data: PRODUCT_REVIEWS });

    await listProductReviews('a/b?c');

    expect(lastCall()[0]).toMatch(/\/products\/a%2Fb%3Fc\/reviews$/);
  });

  it('response thiếu khoá phân bố bị Zod từ chối (không để dữ liệu lạ lọt vào UI)', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...PRODUCT_REVIEWS,
        summary: { ...PRODUCT_REVIEWS.summary, distribution: { '1': 0, '2': 0 } },
      },
    });

    await expect(listProductReviews('ao-thun')).rejects.toThrow();
  });

  it('sản phẩm không công khai -> 404 giữ nguyên ApiError để Server Component gọi notFound()', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Product not found' }, 404);

    await expect(listProductReviews('ao-nhap')).rejects.toMatchObject({ status: 404 });
  });
});

describe('review.service — người mua', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createReview -> POST /reviews với body JSON, trả đánh giá đã parse', async () => {
    mockFetchOnce({ success: true, data: REVIEW }, 201);

    const review = await createReview({
      orderId: 'order-1',
      productId: 'product-1',
      rating: 5,
      comment: 'Áo đẹp, giao nhanh',
    });

    expect(review.id).toBe('review-1');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/reviews$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      orderId: 'order-1',
      productId: 'product-1',
      rating: 5,
      comment: 'Áo đẹp, giao nhanh',
    });
  });

  it('createReview — 409 giữ nguyên code của BE (vd REVIEW_NOT_ALLOWED) để UI dịch theo mã', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Review not allowed: ALREADY_REVIEWED',
        code: 'REVIEW_NOT_ALLOWED',
        details: { reason: 'ALREADY_REVIEWED' },
      },
      409,
    );

    await expect(
      createReview({ orderId: 'order-1', productId: 'product-1', rating: 5 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'REVIEW_NOT_ALLOWED',
      details: { reason: 'ALREADY_REVIEWED' },
    });
  });

  it('updateReview -> PATCH /reviews/:id, id nằm trên URL còn body chỉ có rating + comment', async () => {
    mockFetchOnce({
      success: true,
      data: { ...REVIEW, rating: 4, editedAt: '2026-10-02T00:00:00.000Z' },
    });

    const review = await updateReview('review-1', { rating: 4, comment: 'Cũng ổn' });

    expect(review.editedAt).toBe('2026-10-02T00:00:00.000Z');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/reviews\/review-1$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ rating: 4, comment: 'Cũng ổn' });
  });

  it('updateReview — 409 REVIEW_EDIT_NOT_ALLOWED (đã sửa một lần) là ApiError 409', async () => {
    mockFetchOnce(
      {
        success: false,
        data: null,
        message: 'Review can only be edited once',
        code: 'REVIEW_EDIT_NOT_ALLOWED',
      },
      409,
    );

    await expect(updateReview('review-1', { rating: 3 })).rejects.toMatchObject({
      status: 409,
      code: 'REVIEW_EDIT_NOT_ALLOWED',
    });
  });
});

describe('review.service — seller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listShopReviews không tham số -> GET /shops/:shopId/reviews, parse đánh giá kèm sản phẩm', async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SELLER_REVIEW], total: 1, page: 1, limit: 10 },
    });

    const result = await listShopReviews('shop-1');

    expect(result.items[0].product.slug).toBe('ao-thun');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/reviews$/);
    expect(init.method).toBe('GET');
  });

  it('gửi replied/rating/page/limit lên query string, `replied` giữ nguyên chuỗi "true"/"false"', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 2, limit: 5 } });

    await listShopReviews('shop-1', { replied: 'false', rating: 3, page: 2, limit: 5 });

    expect(lastCall()[0]).toMatch(
      /\/shops\/shop-1\/reviews\?replied=false&rating=3&page=2&limit=5$/,
    );
  });

  it('bỏ trống replied -> không gửi param (BE hiểu là cả hai)', async () => {
    mockFetchOnce({ success: true, data: { items: [], total: 0, page: 1, limit: 10 } });

    await listShopReviews('shop-1', { replied: undefined, page: 1 });

    expect(lastCall()[0]).toMatch(/\/shops\/shop-1\/reviews\?page=1$/);
  });

  it('listShopReviews — shop không phải của mình -> 403 giữ nguyên status', async () => {
    mockFetchOnce({ success: false, data: null, message: 'Forbidden' }, 403);

    await expect(listShopReviews('shop-x')).rejects.toMatchObject({ status: 403 });
  });

  it('replyToReview -> PUT /shops/:shopId/reviews/:id/reply với body { reply }', async () => {
    mockFetchOnce({
      success: true,
      data: {
        ...SELLER_REVIEW,
        sellerReply: 'Cảm ơn bạn!',
        sellerRepliedAt: '2026-10-03T00:00:00.000Z',
      },
    });

    const review = await replyToReview('shop-1', 'review-1', { reply: 'Cảm ơn bạn!' });

    expect(review.sellerReply).toBe('Cảm ơn bạn!');
    const [url, init] = lastCall();
    expect(url).toMatch(/\/shops\/shop-1\/reviews\/review-1\/reply$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ reply: 'Cảm ơn bạn!' });
  });
});
