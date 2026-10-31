import { expectAppException } from '../../shared/testing/expect-app-exception';
import type { ReviewService } from '../review/review.service';
import { AdminReviewsService } from './admin-reviews.service';

// Lớp mỏng phía Admin cho ẩn / hiện đánh giá (Week11.md 5.5): chỉ kiểm dạng id rồi giao cho ReviewService. Luật ẩn và cuộc đua nằm ở
// review.service.spec.ts / admin-reviews.controller.int-spec.ts.
describe('AdminReviewsService', () => {
  const ADMIN = 'admin-1';
  const REVIEW_ID = '3f2c9d7e-8a41-4b6e-9c1d-5e7a2b4c6d80';
  const REASON = 'Ngôn từ xúc phạm';
  const NUL = String.fromCharCode(0);

  let reviewService: { hide: jest.Mock; unhide: jest.Mock };
  let service: AdminReviewsService;

  beforeEach(() => {
    reviewService = {
      hide: jest.fn().mockResolvedValue({ review: { id: REVIEW_ID } }),
      unhide: jest.fn().mockResolvedValue({ review: { id: REVIEW_ID } }),
    };
    service = new AdminReviewsService(
      reviewService as unknown as ReviewService,
    );
  });

  it('id hợp lệ: giao nguyên adminId, reviewId, lý do và ngữ cảnh cho ReviewService', async () => {
    const context = { ip: '203.0.113.7' };

    await service.hide(ADMIN, REVIEW_ID, REASON, context);
    await service.unhide(ADMIN, REVIEW_ID, REASON, context);

    const expected = {
      adminId: ADMIN,
      reviewId: REVIEW_ID,
      reason: REASON,
      context,
    };
    expect(reviewService.hide).toHaveBeenCalledWith(expected);
    expect(reviewService.unhide).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['rỗng', ''],
    ['không phải UUID', 'not-a-uuid'],
    ['có NUL (Postgres không nhận)', `a${NUL}b`],
    ['có đường dẫn', '../../etc/passwd'],
  ])(
    'id %s ⇒ 404 REVIEW_NOT_FOUND và KHÔNG chạm tới ReviewService (không xuống DB)',
    async (_name, id) => {
      const expected = { status: 404, code: 'REVIEW_NOT_FOUND' };

      await expectAppException(
        Promise.resolve().then(() => service.hide(ADMIN, id, REASON)),
        expected,
      );
      await expectAppException(
        Promise.resolve().then(() => service.unhide(ADMIN, id, REASON)),
        expected,
      );

      expect(reviewService.hide).not.toHaveBeenCalled();
      expect(reviewService.unhide).not.toHaveBeenCalled();
    },
  );
});
