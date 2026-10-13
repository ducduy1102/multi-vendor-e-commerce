import {
  createReviewSchema,
  errorDetailsSchemas,
  listReviewsQuerySchema,
  orderItemReviewSchema,
  productCardSchema,
  productDetailSchema,
  productReviewsResponseSchema,
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_REPLY_MAX_LENGTH,
  reviewDistributionSchema,
  reviewFormSchema,
  reviewRatingSchema,
  reviewSchema,
  reviewSummarySchema,
  replyReviewSchema,
  sellerReviewListQuerySchema,
  sellerReviewListResponseSchema,
  sellerReviewSchema,
  updateReviewSchema,
} from '@ecommerce/types';

// Schema Zod dùng chung cho đánh giá (packages/types/src/review.ts) và phần điểm đánh giá của card/chi
// tiết sản phẩm (Week9.md 2.2). Cùng precedent order-schemas.spec.ts: packages/types không có test
// runner riêng.

const messagesOf = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) =>
  result.success
    ? []
    : (result.error?.issues.map((issue) => issue.message) ?? []);

describe('reviewRatingSchema', () => {
  it.each([1, 2, 3, 4, 5])('nhận %s', (rating) => {
    expect(reviewRatingSchema.parse(rating)).toBe(rating);
  });

  it.each([0, 6, -1, 1.5, 4.9])('từ chối %s là không hợp lệ', (rating) => {
    expect(messagesOf(reviewRatingSchema.safeParse(rating))).toEqual([
      'review.validationRatingInvalid',
    ]);
  });

  it.each([undefined, null, '5', NaN])(
    'chưa chọn sao / sai kiểu (%s) ⇒ báo chưa chọn',
    (value) => {
      expect(messagesOf(reviewRatingSchema.safeParse(value))).toEqual([
        'review.validationRatingRequired',
      ]);
    },
  );
});

describe('createReviewSchema / reviewFormSchema / updateReviewSchema', () => {
  const base = { orderId: 'o1', productId: 'p1', rating: 5 };

  it('hợp lệ: comment tuỳ chọn, đã trim', () => {
    expect(createReviewSchema.parse(base)).toEqual(base);
    expect(
      createReviewSchema.parse({ ...base, comment: '  Rất tốt  ' }).comment,
    ).toBe('Rất tốt');
  });

  it('comment rỗng "" coi như chưa nhập (bỏ field)', () => {
    expect(
      createReviewSchema.parse({ ...base, comment: '   ' }).comment,
    ).toBeUndefined();
  });

  it(`comment tối đa ${REVIEW_COMMENT_MAX_LENGTH} ký tự (đếm sau trim)`, () => {
    expect(
      createReviewSchema.safeParse({
        ...base,
        comment: 'x'.repeat(REVIEW_COMMENT_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      messagesOf(
        createReviewSchema.safeParse({
          ...base,
          comment: 'x'.repeat(REVIEW_COMMENT_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['review.validationCommentTooLong']);
  });

  it('thiếu orderId/productId bị từ chối (BE kiểm điều kiện nghiệp vụ, schema chỉ bắt thiếu)', () => {
    expect(
      createReviewSchema.safeParse({ productId: 'p1', rating: 5 }).success,
    ).toBe(false);
    expect(
      createReviewSchema.safeParse({ orderId: 'o1', rating: 5 }).success,
    ).toBe(false);
    expect(createReviewSchema.safeParse({ ...base, orderId: '' }).success).toBe(
      false,
    );
  });

  it('form chỉ có rating + comment; field lạ (orderId/userId) bị bỏ', () => {
    const parsed = reviewFormSchema.parse({
      rating: 4,
      comment: 'Ổn',
      orderId: 'o1',
      userId: 'u1',
    });

    expect(parsed).toEqual({ rating: 4, comment: 'Ổn' });
    expect(messagesOf(reviewFormSchema.safeParse({ comment: 'Ổn' }))).toEqual([
      'review.validationRatingRequired',
    ]);
  });

  it('sửa đánh giá gửi lại ĐỦ rating + comment (cùng shape form)', () => {
    expect(updateReviewSchema).toBe(reviewFormSchema);
  });
});

describe('replyReviewSchema', () => {
  it('lời trả lời bắt buộc, đã trim', () => {
    expect(replyReviewSchema.parse({ reply: '  Cảm ơn bạn  ' })).toEqual({
      reply: 'Cảm ơn bạn',
    });
    expect(messagesOf(replyReviewSchema.safeParse({}))).toEqual([
      'review.validationReplyRequired',
    ]);
    expect(messagesOf(replyReviewSchema.safeParse({ reply: '   ' }))).toEqual([
      'review.validationReplyRequired',
    ]);
  });

  it(`tối đa ${REVIEW_REPLY_MAX_LENGTH} ký tự`, () => {
    expect(
      replyReviewSchema.safeParse({
        reply: 'x'.repeat(REVIEW_REPLY_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      messagesOf(
        replyReviewSchema.safeParse({
          reply: 'x'.repeat(REVIEW_REPLY_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['review.validationReplyTooLong']);
  });
});

describe('listReviewsQuerySchema', () => {
  it('mặc định page=1, limit=10, không lọc sao', () => {
    expect(listReviewsQuerySchema.parse({})).toEqual({ page: 1, limit: 10 });
  });

  it('query param là string ⇒ coerce number', () => {
    expect(
      listReviewsQuerySchema.parse({ rating: '5', page: '2', limit: '20' }),
    ).toEqual({
      rating: 5,
      page: 2,
      limit: 20,
    });
  });

  it.each(['0', '6', '1.5', 'abc'])('rating=%s bị từ chối', (rating) => {
    expect(listReviewsQuerySchema.safeParse({ rating }).success).toBe(false);
  });

  it('limit tối đa 50, page phải dương', () => {
    expect(listReviewsQuerySchema.safeParse({ limit: '51' }).success).toBe(
      false,
    );
    expect(listReviewsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('response công khai', () => {
  const review = {
    id: 'r1',
    rating: 5,
    comment: null,
    createdAt: '2026-10-07T10:00:00.000Z',
    editedAt: null,
    reviewerName: 'N***',
    sellerReply: null,
    sellerRepliedAt: null,
  };

  it('reviewSchema KHÔNG giữ userId/email dù BE lỡ trả (không lộ danh tính người đánh giá)', () => {
    const parsed = reviewSchema.parse({
      ...review,
      userId: 'u1',
      email: 'a@b.c',
    });

    expect(parsed).toEqual(review);
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
  });

  it('reviewDistributionSchema bắt buộc đủ 5 khoá, mỗi khoá là số đếm không âm', () => {
    const distribution = { '1': 0, '2': 1, '3': 0, '4': 3, '5': 9 };

    expect(reviewDistributionSchema.parse(distribution)).toEqual(distribution);
    expect(
      reviewDistributionSchema.safeParse({ '1': 0, '2': 0, '3': 0, '4': 0 })
        .success,
    ).toBe(false);
    expect(
      reviewDistributionSchema.safeParse({ ...distribution, '5': -1 }).success,
    ).toBe(false);
  });

  it('reviewSummarySchema: 0 đánh giá hợp lệ (0/0), điểm trung bình ngoài 0–5 bị từ chối', () => {
    const empty = {
      avgRating: 0,
      reviewCount: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    };

    expect(reviewSummarySchema.safeParse(empty).success).toBe(true);
    expect(
      reviewSummarySchema.safeParse({ ...empty, avgRating: 5.01 }).success,
    ).toBe(false);
    expect(
      reviewSummarySchema.safeParse({ ...empty, avgRating: -0.1 }).success,
    ).toBe(false);
  });

  it('productReviewsResponseSchema parse đủ summary + items + phân trang', () => {
    const parsed = productReviewsResponseSchema.parse({
      summary: {
        avgRating: 4.5,
        reviewCount: 2,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
      },
      items: [review],
      total: 2,
      page: 1,
      limit: 10,
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.summary.distribution['5']).toBe(1);
  });
});

describe('điểm đánh giá trên card và chi tiết sản phẩm', () => {
  const card = {
    id: 'p1',
    categoryId: 'c1',
    name: 'Áo',
    slug: 'ao',
    minPrice: '100000',
    maxPrice: '100000',
    imageUrl: null,
  };

  it('productCardSchema bắt buộc avgRating/reviewCount (0/0 khi chưa có đánh giá)', () => {
    expect(
      productCardSchema.safeParse({ ...card, avgRating: 0, reviewCount: 0 })
        .success,
    ).toBe(true);
    expect(productCardSchema.safeParse(card).success).toBe(false);
    expect(
      productCardSchema.safeParse({ ...card, avgRating: 6, reviewCount: 1 })
        .success,
    ).toBe(false);
    expect(
      productCardSchema.safeParse({ ...card, avgRating: 4, reviewCount: -1 })
        .success,
    ).toBe(false);
  });

  it('productDetailSchema cũng có avgRating/reviewCount (response public của chi tiết)', () => {
    const shape = productDetailSchema.shape;

    expect(shape).toHaveProperty('avgRating');
    expect(shape).toHaveProperty('reviewCount');
    expect(shape).toHaveProperty('shop');
  });

  it('REVIEW_NOT_ALLOWED.details.reason nhận đủ 4 lý do, từ chối giá trị lạ', () => {
    for (const reason of [
      'ORDER_NOT_COMPLETED',
      'NOT_PURCHASED',
      'WINDOW_EXPIRED',
      'ALREADY_REVIEWED',
    ]) {
      expect(
        errorDetailsSchemas.REVIEW_NOT_ALLOWED.safeParse({ reason }).success,
      ).toBe(true);
    }
    expect(
      errorDetailsSchemas.REVIEW_NOT_ALLOWED.safeParse({ reason: 'NOPE' })
        .success,
    ).toBe(false);
  });
});

describe('sellerReviewListQuerySchema (Week9.md 2.10)', () => {
  it('mặc định trang 1, 10 dòng, không lọc', () => {
    expect(sellerReviewListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
    });
  });

  it("replied nhận đúng chuỗi 'true'/'false' như trên URL (không coerce boolean: 'false' không được thành true)", () => {
    expect(sellerReviewListQuerySchema.parse({ replied: 'true' }).replied).toBe(
      'true',
    );
    expect(
      sellerReviewListQuerySchema.parse({ replied: 'false' }).replied,
    ).toBe('false');
  });

  it.each([
    { replied: 'maybe' },
    { replied: '' },
    { replied: true },
    { rating: '0' },
    { rating: '6' },
    { limit: '51' },
  ])('query %j ⇒ lỗi', (input) => {
    expect(sellerReviewListQuerySchema.safeParse(input).success).toBe(false);
  });

  it('lọc sao + phân trang là chuỗi từ URL', () => {
    expect(
      sellerReviewListQuerySchema.parse({
        rating: '2',
        page: '3',
        limit: '25',
      }),
    ).toEqual({ rating: 2, page: 3, limit: 25 });
  });
});

describe('sellerReviewSchema / sellerReviewListResponseSchema', () => {
  const review = {
    id: 'rv-1',
    rating: 5,
    comment: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    editedAt: null,
    reviewerName: 'N***',
    sellerReply: null,
    sellerRepliedAt: null,
    product: { id: 'p1', name: 'Áo thun', slug: 'ao-thun' },
  };

  it('giữ sản phẩm được đánh giá và KHÔNG giữ field thừa (userId/email) lọt từ BE', () => {
    const parsed = sellerReviewSchema.parse({
      ...review,
      userId: 'user-secret',
      email: 'secret@example.com',
    });

    expect(parsed.product).toEqual(review.product);
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
  });

  it('danh sách parse được', () => {
    expect(() =>
      sellerReviewListResponseSchema.parse({
        items: [review],
        total: 1,
        page: 1,
        limit: 10,
      }),
    ).not.toThrow();
  });

  it('thiếu product ⇒ lỗi', () => {
    const { product, ...withoutProduct } = review;
    void product;
    expect(sellerReviewSchema.safeParse(withoutProduct).success).toBe(false);
  });
});

describe('orderItemReviewSchema (đánh giá của chính mình trên dòng hàng)', () => {
  it('giữ đủ trường FE cần để dựng nút sửa và điền sẵn form', () => {
    const review = {
      id: 'rv-1',
      rating: 4,
      comment: 'Tốt',
      editedAt: '2026-10-09T10:00:00.000Z',
      canEdit: false,
    };

    expect(orderItemReviewSchema.parse(review)).toEqual(review);
  });

  it('nhận xét / mốc sửa có thể null', () => {
    expect(
      orderItemReviewSchema.parse({
        id: 'rv-1',
        rating: 4,
        comment: null,
        editedAt: null,
        canEdit: true,
      }),
    ).toMatchObject({ comment: null, editedAt: null });
  });
});
