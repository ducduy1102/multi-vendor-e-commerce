import { describe, expect, it } from 'vitest';

import {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_REPLY_MAX_LENGTH,
  replyReviewSchema,
  reviewFormSchema,
} from './review.schema';

describe('reviewFormSchema', () => {
  it('rating + comment hợp lệ -> giữ nguyên (comment đã trim)', () => {
    expect(reviewFormSchema.parse({ rating: 4, comment: '  Tốt  ' })).toEqual({
      rating: 4,
      comment: 'Tốt',
    });
  });

  // Regression: React Hook Form gửi "" cho ô nhận xét bỏ trống (không phải undefined) — phải coi là
  // chưa nhập, không lọt chuỗi rỗng vào payload gửi BE.
  it.each([{}, { comment: '' }, { comment: '   ' }])(
    'nhận xét bỏ trống/khoảng trắng coi như chưa nhập: %j',
    (extra) => {
      expect(reviewFormSchema.parse({ rating: 5, ...extra })).toEqual({
        rating: 5,
        comment: undefined,
      });
    },
  );

  it('chưa chọn sao -> key i18n review.validationRatingRequired', () => {
    const result = reviewFormSchema.safeParse({ comment: 'Tốt' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('review.validationRatingRequired');
    }
  });

  it.each([0, 6, 3.5, -1])(
    'số sao %s ngoài 1-5 hoặc không nguyên -> review.validationRatingInvalid',
    (rating) => {
      const result = reviewFormSchema.safeParse({ rating });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('review.validationRatingInvalid');
      }
    },
  );

  it('nhận xét đúng giới hạn thì hợp lệ, vượt 1 ký tự -> review.validationCommentTooLong', () => {
    expect(
      reviewFormSchema.safeParse({ rating: 5, comment: 'a'.repeat(REVIEW_COMMENT_MAX_LENGTH) })
        .success,
    ).toBe(true);

    const result = reviewFormSchema.safeParse({
      rating: 5,
      comment: 'a'.repeat(REVIEW_COMMENT_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('review.validationCommentTooLong');
    }
  });
});

describe('replyReviewSchema', () => {
  it('trả lời hợp lệ -> giữ nguyên (đã trim)', () => {
    expect(replyReviewSchema.parse({ reply: '  Cảm ơn bạn!  ' })).toEqual({
      reply: 'Cảm ơn bạn!',
    });
  });

  it.each([{}, { reply: '' }, { reply: '   ' }])(
    'nội dung bắt buộc: %j -> key i18n review.validationReplyRequired',
    (input) => {
      const result = replyReviewSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('review.validationReplyRequired');
      }
    },
  );

  it('vượt giới hạn -> review.validationReplyTooLong', () => {
    const result = replyReviewSchema.safeParse({ reply: 'a'.repeat(REVIEW_REPLY_MAX_LENGTH + 1) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('review.validationReplyTooLong');
    }
  });
});
