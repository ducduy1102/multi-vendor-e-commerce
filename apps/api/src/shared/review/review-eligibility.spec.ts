import type { OrderStatus } from '@prisma/client';
import {
  getReviewBlockReason,
  isWithinReviewWindow,
  readReviewWindowDays,
  type ReviewEligibilityInput,
} from './review-eligibility';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-10T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const eligible = (
  overrides: Partial<ReviewEligibilityInput> = {},
): ReviewEligibilityInput => ({
  containsProduct: true,
  orderStatus: 'COMPLETED',
  completedAt: daysAgo(1),
  now: NOW,
  windowDays: 90,
  alreadyReviewed: false,
  ...overrides,
});

describe('readReviewWindowDays', () => {
  afterEach(() => {
    delete process.env.REVIEW_WINDOW_DAYS;
  });

  it('mặc định 90 ngày khi không cấu hình', () => {
    expect(readReviewWindowDays()).toBe(90);
  });

  it('lấy từ REVIEW_WINDOW_DAYS và đọc LÚC DÙNG (đổi giữa hai lần gọi có hiệu lực ngay)', () => {
    process.env.REVIEW_WINDOW_DAYS = '30';
    expect(readReviewWindowDays()).toBe(30);
    process.env.REVIEW_WINDOW_DAYS = '7';
    expect(readReviewWindowDays()).toBe(7);
  });

  it.each(['', '0', '-3', 'abc', '1.5'])(
    'giá trị %p — về mặc định 90, không ném lỗi',
    (value) => {
      process.env.REVIEW_WINDOW_DAYS = value;
      expect(readReviewWindowDays()).toBe(90);
    },
  );
});

describe('isWithinReviewWindow', () => {
  it('còn trong cửa sổ, kể cả đúng thời điểm hết hạn (biên bao gồm)', () => {
    expect(isWithinReviewWindow(daysAgo(89), NOW, 90)).toBe(true);
    expect(isWithinReviewWindow(daysAgo(90), NOW, 90)).toBe(true);
  });

  it('quá 1 mili-giây là hết hạn', () => {
    expect(
      isWithinReviewWindow(new Date(daysAgo(90).getTime() - 1), NOW, 90),
    ).toBe(false);
    expect(isWithinReviewWindow(daysAgo(91), NOW, 90)).toBe(false);
  });

  it('số ngày của cửa sổ lấy từ tham số', () => {
    expect(isWithinReviewWindow(daysAgo(10), NOW, 7)).toBe(false);
    expect(isWithinReviewWindow(daysAgo(10), NOW, 30)).toBe(true);
  });
});

describe('getReviewBlockReason (Week9.md 1.8) — ma trận điều kiện', () => {
  it('đơn COMPLETED chứa sản phẩm, còn trong cửa sổ, chưa đánh giá ⇒ được', () => {
    expect(getReviewBlockReason(eligible())).toBeNull();
  });

  it('đơn COMPLETED vừa hoàn tất đúng lúc hết hạn vẫn được (biên bao gồm)', () => {
    expect(
      getReviewBlockReason(eligible({ completedAt: daysAgo(90) })),
    ).toBeNull();
  });

  it('sản phẩm không có trong đơn ⇒ NOT_PURCHASED', () => {
    expect(getReviewBlockReason(eligible({ containsProduct: false }))).toBe(
      'NOT_PURCHASED',
    );
  });

  it.each([
    'AWAITING_PAYMENT',
    'PENDING',
    'CONFIRMED',
    'PACKED',
    'SHIPPING',
    'CANCELLED',
    'REFUNDED',
  ] as OrderStatus[])(
    'đơn %s (chưa/không còn COMPLETED) ⇒ ORDER_NOT_COMPLETED',
    (orderStatus) => {
      expect(getReviewBlockReason(eligible({ orderStatus }))).toBe(
        'ORDER_NOT_COMPLETED',
      );
    },
  );

  it('quá cửa sổ ⇒ WINDOW_EXPIRED', () => {
    expect(getReviewBlockReason(eligible({ completedAt: daysAgo(91) }))).toBe(
      'WINDOW_EXPIRED',
    );
  });

  it('không có dấu vết lúc hoàn tất ⇒ coi như hết hạn (từ chối an toàn)', () => {
    expect(getReviewBlockReason(eligible({ completedAt: null }))).toBe(
      'WINDOW_EXPIRED',
    );
  });

  it('đã đánh giá sản phẩm này trong đơn này ⇒ ALREADY_REVIEWED', () => {
    expect(getReviewBlockReason(eligible({ alreadyReviewed: true }))).toBe(
      'ALREADY_REVIEWED',
    );
  });

  describe('thứ tự ưu tiên khi nhiều điều kiện cùng vi phạm', () => {
    it('NOT_PURCHASED đứng trước mọi lý do còn lại (trạng thái đơn không còn ý nghĩa)', () => {
      expect(
        getReviewBlockReason(
          eligible({
            containsProduct: false,
            orderStatus: 'PENDING',
            completedAt: null,
            alreadyReviewed: true,
          }),
        ),
      ).toBe('NOT_PURCHASED');
    });

    it('ORDER_NOT_COMPLETED đứng trước WINDOW_EXPIRED và ALREADY_REVIEWED', () => {
      expect(
        getReviewBlockReason(
          eligible({
            orderStatus: 'REFUNDED',
            completedAt: daysAgo(200),
            alreadyReviewed: true,
          }),
        ),
      ).toBe('ORDER_NOT_COMPLETED');
    });

    it('WINDOW_EXPIRED đứng trước ALREADY_REVIEWED', () => {
      expect(
        getReviewBlockReason(
          eligible({ completedAt: daysAgo(200), alreadyReviewed: true }),
        ),
      ).toBe('WINDOW_EXPIRED');
    });
  });

  it('số ngày cửa sổ lấy từ input (cùng một đơn, hai chính sách khác nhau)', () => {
    const completedAt = daysAgo(30);
    expect(getReviewBlockReason(eligible({ completedAt, windowDays: 7 }))).toBe(
      'WINDOW_EXPIRED',
    );
    expect(
      getReviewBlockReason(eligible({ completedAt, windowDays: 90 })),
    ).toBeNull();
  });
});
