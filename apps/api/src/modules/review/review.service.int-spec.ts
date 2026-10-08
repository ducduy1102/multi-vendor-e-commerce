import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createOrderWithItem,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { ProductRatingService } from '../product/product-rating.service';
import { ReviewService } from './review.service';

// Integration test trên DB dev THẬT cho phần khó nhất của review (Week9.md 1.8, 2.10): điểm trung bình
// denormalized trên Product phải ĐÚNG và không deadlock khi nhiều người đánh giá / sửa cùng một sản phẩm
// đồng thời. HTTP thật đã được phủ ở review.controller.int-spec.ts; ở đây gọi thẳng service để đẩy độ song song
// cao hơn (không bị giới hạn bởi đăng nhập từng người) và dựng được ca ĐỐI CHỨNG chứng minh thứ tự "khoá product
// trước, chèn review sau" không phải mê tín. Chạy: `pnpm test:int`.
const TAG = 'it-review-svc-';

describe('ReviewService / ProductRatingService (DB thật)', () => {
  const prisma = new PrismaClient();
  const rating = new ProductRatingService();
  const reviews = new ReviewService(prisma as unknown as PrismaService, rating);

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  // Sản phẩm mới của một shop mới + `buyers` người mua, mỗi người một đơn COMPLETED chứa sản phẩm đó.
  async function setup(buyers: number) {
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 10 });
    const people: { userId: string; orderId: string }[] = [];
    for (let i = 0; i < buyers; i++) {
      const user = await createUser(prisma, TAG);
      const { orderId } = await createOrderWithItem(prisma, {
        userId: user.id,
        shopId: base.shopId,
        variantId: variant.id,
      });
      people.push({ userId: user.id, orderId });
    }
    return { productId: base.productId, shopId: base.shopId, people };
  }

  const stored = (productId: string) =>
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { avgRating: true, reviewCount: true },
    });

  // Sự thật tính thẳng từ bảng reviews bằng SQL, độc lập với ProductRatingService.
  async function truth(productId: string) {
    const [row] = await prisma.$queryRaw<{ cnt: number; avg: number | null }[]>`
      SELECT COUNT(*)::int AS cnt, ROUND(AVG(rating)::numeric, 2)::float8 AS avg
      FROM reviews WHERE product_id = ${productId}`;
    return { reviewCount: row.cnt, avgRating: row.avg ?? 0 };
  }

  describe('đồng thời trên cùng một sản phẩm', () => {
    it('12 người đánh giá CÙNG LÚC (3 vòng) — tất cả thành công, không deadlock, reviewCount / avgRating khớp dữ liệu thật', async () => {
      for (let round = 0; round < 3; round++) {
        const { productId, people } = await setup(12);

        const results = await Promise.allSettled(
          people.map((person, i) =>
            reviews.create(person.userId, {
              orderId: person.orderId,
              productId,
              rating: ((i + round) % 5) + 1,
            }),
          ),
        );

        expect(results.map((r) => r.status)).toEqual(
          people.map(() => 'fulfilled'),
        );
        expect(await stored(productId)).toEqual(await truth(productId));
        expect((await stored(productId)).reviewCount).toBe(12);
      }
    });

    it('vừa đánh giá mới vừa sửa đánh giá cũ CÙNG LÚC — không deadlock, điểm cuối khớp dữ liệu thật', async () => {
      const { productId, people } = await setup(12);
      const existing = people.slice(0, 6);
      const incoming = people.slice(6);
      const created = await Promise.all(
        existing.map((person) =>
          reviews.create(person.userId, {
            orderId: person.orderId,
            productId,
            rating: 5,
          }),
        ),
      );

      const results = await Promise.allSettled([
        ...created.map((review, i) =>
          reviews.update(existing[i].userId, review.id, {
            rating: (i % 5) + 1,
          }),
        ),
        ...incoming.map((person, i) =>
          reviews.create(person.userId, {
            orderId: person.orderId,
            productId,
            rating: ((i + 2) % 5) + 1,
          }),
        ),
      ]);

      expect(results.map((r) => r.status)).toEqual(
        results.map(() => 'fulfilled'),
      );
      const row = await stored(productId);
      expect(row).toEqual(await truth(productId));
      expect(row.reviewCount).toBe(12);
    });

    it('nhiều sản phẩm khác nhau không chờ nhau: đánh giá đồng thời trên 4 sản phẩm đều xong và mỗi sản phẩm đúng số lượng', async () => {
      const groups = await Promise.all([
        setup(4),
        setup(4),
        setup(4),
        setup(4),
      ]);

      const results = await Promise.allSettled(
        groups.flatMap(({ productId, people }) =>
          people.map((person, i) =>
            reviews.create(person.userId, {
              orderId: person.orderId,
              productId,
              rating: i + 1,
            }),
          ),
        ),
      );

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      for (const { productId } of groups) {
        expect(await stored(productId)).toEqual({
          avgRating: 2.5,
          reviewCount: 4,
        });
      }
    });
  });

  describe('ĐỐI CHỨNG: vì sao updateRating khoá product TRƯỚC khi chèn review', () => {
    // Chèn review (FK giữ FOR KEY SHARE trên dòng product) RỒI MỚI xin FOR UPDATE để tính lại: hai giao dịch cùng
    // làm vậy mỗi bên giữ KEY SHARE chờ bên kia nhả ⇒ Postgres phải huỷ một bên (deadlock). Rào chắn đảm bảo cả hai
    // đã chèn xong trước khi ai xin khoá, nên ca này xảy ra CHẮC CHẮN thay vì chờ may rủi. Test này không phải test
    // sản phẩm — nó chứng minh thứ tự khoá trong updateRating là cần thiết, và sẽ báo ngay nếu ai đó "đơn giản hoá"
    // quay về chèn trước khoá sau.
    function barrier(parties: number) {
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return async () => {
        arrived += 1;
        if (arrived >= parties) release();
        await gate;
      };
    }

    it('chèn trước – khoá sau (SAI thứ tự) ⇒ đúng một giao dịch bị huỷ vì deadlock', async () => {
      const { productId, people } = await setup(2);
      const arrive = barrier(2);

      const run = (person: { userId: string; orderId: string }) =>
        prisma.$transaction(
          async (tx) => {
            await tx.review.create({
              data: {
                userId: person.userId,
                productId,
                orderId: person.orderId,
                rating: 5,
              },
            });
            await arrive();
            await rating.recompute(tx, productId);
          },
          { maxWait: 10_000, timeout: 30_000 },
        );

      const results = await Promise.allSettled(people.map(run));

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason)).toMatch(/deadlock|P2034|40P01/i);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }, 60_000);
  });

  describe('recompute', () => {
    it('tự chữa lành số liệu lệch: ghi đè giá trị sai bằng giá trị tính từ reviews', async () => {
      const { productId, people } = await setup(3);
      for (const [i, person] of people.entries()) {
        await reviews.create(person.userId, {
          orderId: person.orderId,
          productId,
          rating: i + 3, // 3, 4, 5
        });
      }
      await prisma.$executeRaw`
        UPDATE products SET avg_rating = 1, review_count = 99 WHERE id = ${productId}`;

      const result = await prisma.$transaction((tx) =>
        rating.recompute(tx, productId),
      );

      expect(result).toEqual({ avgRating: 4, reviewCount: 3 });
      expect(await stored(productId)).toEqual({ avgRating: 4, reviewCount: 3 });
    });

    it('không còn review nào ⇒ về 0 / 0', async () => {
      const { productId } = await setup(0);
      await prisma.$executeRaw`
        UPDATE products SET avg_rating = 4.5, review_count = 7 WHERE id = ${productId}`;

      await prisma.$transaction((tx) => rating.recompute(tx, productId));

      expect(await stored(productId)).toEqual({ avgRating: 0, reviewCount: 0 });
    });

    it('khớp ROUND(AVG(...), 2) của SQL ở mốc làm tròn x.xx5 (4.285 ⇒ 4.29)', async () => {
      // 200 review với tổng 857 điểm ⇒ 4.285 chính xác: 143 lượt 4 sao + 57 lượt 5 sao.
      const { productId, people } = await setup(1);
      const orderId = people[0].orderId;
      const userId = people[0].userId;
      // Chèn thẳng 200 dòng (mỗi dòng cần cặp [user, order] riêng ⇒ dùng nhiều user, cùng 1 đơn không được).
      const extra = await Promise.all(
        Array.from({ length: 199 }, async () => {
          const user = await createUser(prisma, TAG);
          return user.id;
        }),
      );
      const owners = [userId, ...extra];
      await prisma.$transaction(
        async (tx) => {
          for (const [i, owner] of owners.entries()) {
            await tx.review.create({
              data: {
                userId: owner,
                productId,
                orderId,
                rating: i < 57 ? 5 : 4,
              },
            });
          }
        },
        { timeout: 60_000 },
      );

      const result = await prisma.$transaction((tx) =>
        rating.recompute(tx, productId),
      );

      expect(result).toEqual({ avgRating: 4.29, reviewCount: 200 });
      expect(await truth(productId)).toEqual({
        avgRating: 4.29,
        reviewCount: 200,
      });
    }, 60_000);

    it('sản phẩm không tồn tại ⇒ 404, không ghi gì', async () => {
      await expect(
        prisma.$transaction((tx) =>
          rating.recompute(tx, '00000000-0000-4000-8000-000000000000'),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRating', () => {
    it('thay đổi ném lỗi ⇒ giao dịch rollback: điểm không đổi và khoá được nhả (giao dịch kế tiếp chạy ngay, không chờ)', async () => {
      const { productId, people } = await setup(1);
      await reviews.create(people[0].userId, {
        orderId: people[0].orderId,
        productId,
        rating: 4,
      });

      await expect(
        prisma.$transaction((tx) =>
          rating.updateRating(tx, productId, () =>
            Promise.reject(new Error('boom')),
          ),
        ),
      ).rejects.toThrow('boom');

      const started = Date.now();
      await prisma.$transaction((tx) =>
        rating.updateRating(tx, productId, () => Promise.resolve()),
      );
      expect(Date.now() - started).toBeLessThan(3000);
      expect(await stored(productId)).toEqual({ avgRating: 4, reviewCount: 1 });
    });
  });
});
