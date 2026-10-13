import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import {
  ProductRatingService,
  summarizeRatings,
  toDistribution,
  type RatingDistribution,
} from './product-rating.service';

const dist = (
  one: number,
  two: number,
  three: number,
  four: number,
  five: number,
): RatingDistribution => ({
  '1': one,
  '2': two,
  '3': three,
  '4': four,
  '5': five,
});

describe('toDistribution', () => {
  it('đủ 5 khoá cố định, mức không có đánh giá là 0', () => {
    expect(toDistribution([])).toEqual(dist(0, 0, 0, 0, 0));
    expect(
      toDistribution([
        { rating: 5, _count: { _all: 2 } },
        { rating: 3, _count: { _all: 1 } },
      ]),
    ).toEqual(dist(0, 0, 1, 0, 2));
  });

  it('cộng dồn khi cùng một mức xuất hiện nhiều dòng', () => {
    expect(
      toDistribution([
        { rating: 4, _count: { _all: 2 } },
        { rating: 4, _count: { _all: 3 } },
      ])['4'],
    ).toBe(5);
  });

  it('bỏ qua mức ngoài 1-5 (không thể có vì CHECK DB) thay vì làm hỏng phân bố', () => {
    expect(
      toDistribution([
        { rating: 0, _count: { _all: 9 } },
        { rating: 6, _count: { _all: 9 } },
        { rating: 2, _count: { _all: 1 } },
      ]),
    ).toEqual(dist(0, 1, 0, 0, 0));
  });
});

describe('summarizeRatings — làm tròn', () => {
  it('chưa có đánh giá nào ⇒ 0 / 0', () => {
    expect(summarizeRatings(dist(0, 0, 0, 0, 0))).toEqual({
      avgRating: 0,
      reviewCount: 0,
    });
  });

  it.each([
    [dist(1, 0, 0, 0, 0), 1, 1],
    [dist(0, 0, 0, 0, 1), 5, 1],
    [dist(0, 0, 0, 0, 7), 5, 7],
    [dist(0, 0, 1, 0, 0), 3, 1],
    [dist(0, 0, 0, 1, 1), 4.5, 2],
    // (5+5+4)/3 = 4.666… ⇒ 4.67
    [dist(0, 0, 0, 1, 2), 4.67, 3],
    // (5+4+4)/3 = 4.333… ⇒ 4.33
    [dist(0, 0, 0, 2, 1), 4.33, 3],
    // (1+2)/2 = 1.5 chẵn
    [dist(1, 1, 0, 0, 0), 1.5, 2],
  ])(
    '%j ⇒ trung bình %s trên %s đánh giá',
    (distribution, avgRating, reviewCount) => {
      expect(summarizeRatings(distribution)).toEqual({
        avgRating,
        reviewCount,
      });
    },
  );

  // Mốc x.xx5 là nơi làm tròn bằng số thực hay sai: 857/200 = 4.285 lưu nhị phân là 4.28499… nên
  // Math.round(4.285 * 100) / 100 ra 4.28, trong khi half-up đúng là 4.29 (khớp ROUND(AVG(...), 2) của SQL).
  it('half-up đúng ở mốc x.xx5 mà số thực làm tròn sai (4.285 ⇒ 4.29)', () => {
    expect(summarizeRatings(dist(0, 0, 0, 143, 57))).toEqual({
      avgRating: 4.29,
      reviewCount: 200,
    });
    // 1.005 ⇒ 1.01 (cũng là mốc kinh điển)
    expect(summarizeRatings(dist(199, 1, 0, 0, 0))).toEqual({
      avgRating: 1.01,
      reviewCount: 200,
    });
  });

  it('khớp một nguồn độc lập (decimal.js, ROUND_HALF_UP) trên 3000 phân bố ngẫu nhiên', () => {
    // LCG cố định seed ⇒ test xác định, không flaky.
    let seed = 20_261_008;
    const next = (max: number) => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed % (max + 1);
    };

    for (let i = 0; i < 3000; i++) {
      const distribution = dist(
        next(60),
        next(60),
        next(60),
        next(60),
        next(60),
      );
      const count = Object.values(distribution).reduce((a, b) => a + b, 0);
      if (count === 0) continue;
      const total =
        distribution['1'] +
        2 * distribution['2'] +
        3 * distribution['3'] +
        4 * distribution['4'] +
        5 * distribution['5'];
      const oracle = new Prisma.Decimal(total)
        .div(count)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber();

      expect(summarizeRatings(distribution)).toEqual({
        avgRating: oracle,
        reviewCount: count,
      });
    }
  });

  it('luôn nằm trong [1, 5] khi có đánh giá (thoả CHECK avg_rating của DB)', () => {
    for (const distribution of [
      dist(1, 0, 0, 0, 0),
      dist(0, 0, 0, 0, 1),
      dist(500, 0, 0, 0, 500),
    ]) {
      const { avgRating } = summarizeRatings(distribution);
      expect(avgRating).toBeGreaterThanOrEqual(1);
      expect(avgRating).toBeLessThanOrEqual(5);
    }
  });
});

describe('ProductRatingService', () => {
  let service: ProductRatingService;
  // Thứ tự các câu lệnh trong transaction: khoá → thay đổi → tính lại.
  let calls: string[];
  let lockRows: { id: string }[];
  let groups: { rating: number; _count: { _all: number } }[];
  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    review: { groupBy: jest.Mock };
  };

  beforeEach(() => {
    calls = [];
    lockRows = [{ id: 'p1' }];
    groups = [
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ];
    tx = {
      $queryRaw: jest.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve(lockRows);
      }),
      $executeRaw: jest.fn().mockImplementation(() => {
        calls.push('write');
        return Promise.resolve(1);
      }),
      review: {
        groupBy: jest.fn().mockImplementation(() => {
          calls.push('aggregate');
          return Promise.resolve(groups);
        }),
      },
    };
    service = new ProductRatingService();
  });

  const asTx = () => tx as unknown as TxClient;

  describe('updateRating', () => {
    it('khoá dòng product TRƯỚC khi chạy thay đổi, tính lại SAU — người gọi không thể làm sai thứ tự', async () => {
      await service.updateRating(asTx(), 'p1', () => {
        calls.push('change');
        return Promise.resolve();
      });

      // Lần khoá thứ hai là của recompute (xin lại khoá đã giữ trong cùng transaction là no-op).
      expect(calls).toEqual(['lock', 'change', 'lock', 'aggregate', 'write']);
    });

    it('trả kết quả của thay đổi (vd review vừa tạo)', async () => {
      await expect(
        service.updateRating(asTx(), 'p1', () => Promise.resolve({ id: 'rv' })),
      ).resolves.toEqual({ id: 'rv' });
    });

    it('thay đổi ném lỗi ⇒ KHÔNG tính lại / ghi gì (giao dịch của người gọi rollback)', async () => {
      await expect(
        service.updateRating(asTx(), 'p1', () =>
          Promise.reject(new Error('insert failed')),
        ),
      ).rejects.toThrow('insert failed');

      expect(tx.review.groupBy).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('product không tồn tại ⇒ 404 và KHÔNG chạy thay đổi', async () => {
      lockRows = [];
      const change = jest.fn();

      await expect(
        service.updateRating(asTx(), 'p-khong-co', change),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(change).not.toHaveBeenCalled();
    });
  });

  describe('recompute', () => {
    it('khoá product, tính aggregate theo ĐÚNG sản phẩm, rồi ghi một câu UPDATE', async () => {
      await service.recompute(asTx(), 'p1');

      expect(calls).toEqual(['lock', 'aggregate', 'write']);
      expect(tx.review.groupBy).toHaveBeenCalledWith({
        by: ['rating'],
        where: { productId: 'p1' },
        _count: { _all: true },
      });
    });

    it('ghi điểm trung bình + số đánh giá tính từ aggregate, và trả đúng giá trị đó', async () => {
      const result = await service.recompute(asTx(), 'p1');

      // (5+5+4)/3 = 4.67
      expect(result).toEqual({ avgRating: 4.67, reviewCount: 3 });
      const [strings, ...values] = tx.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(values).toEqual([4.67, 3, 'p1']);
      const sql = strings.join('?');
      expect(sql).toContain('UPDATE products');
      expect(sql).toContain('avg_rating');
      expect(sql).toContain('review_count');
      // Ghi bằng SQL thô nên KHÔNG đụng updated_at (nội dung sản phẩm không đổi khi có đánh giá mới).
      expect(sql).not.toContain('updated_at');
    });

    it('không còn đánh giá nào (vd sau khi dữ liệu bị dọn) ⇒ đặt lại 0 / 0 — tự chữa lành', async () => {
      groups = [];

      const result = await service.recompute(asTx(), 'p1');

      expect(result).toEqual({ avgRating: 0, reviewCount: 0 });
      const values = (
        tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
      ).slice(1);
      expect(values).toEqual([0, 0, 'p1']);
    });

    it('product không tồn tại ⇒ 404, không aggregate / ghi', async () => {
      lockRows = [];

      await expect(
        service.recompute(asTx(), 'p-khong-co'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.review.groupBy).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
