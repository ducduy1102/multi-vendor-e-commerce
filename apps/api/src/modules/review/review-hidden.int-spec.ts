import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  cleanupByTag,
  createOrderWithItem,
  createShopWithProduct,
  createUser,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { ProductRatingService } from '../product/product-rating.service';

// Integration test trên Postgres THẬT cho ba cột ẩn của `reviews` (Week11.md 5.5, migration add_review_hidden_columns). Là lưới an toàn
// cuối nên ghi thẳng bằng Prisma, đi VÒNG qua mọi service: ràng buộc phải đúng kể cả khi service có lỗi. Chạy: `pnpm test:int`.
const TAG = 'it-review-hidden-';

describe('reviews.hidden_* (DB thật)', () => {
  const prisma = new PrismaClient();
  const rating = new ProductRatingService();
  let shop: { shopId: string; productId: string; variantId: string };

  // Mỗi đánh giá cần một đơn riêng (unique user + sản phẩm + đơn).
  async function newReview(stars: number) {
    const user = await createUser(prisma, TAG);
    const { orderId } = await createOrderWithItem(prisma, {
      userId: user.id,
      shopId: shop.shopId,
      variantId: shop.variantId,
    });
    return prisma.review.create({
      data: {
        userId: user.id,
        productId: shop.productId,
        orderId,
        rating: stars,
        comment: 'Nhận xét',
      },
    });
  }

  const hiddenCols = {
    hiddenAt: new Date(),
    hiddenById: randomUUID(),
    hiddenReason: 'Vi phạm quy định cộng đồng',
  };
  const setHidden = (id: string, data: Prisma.ReviewUncheckedUpdateInput) =>
    prisma.review.update({ where: { id }, data });

  async function rejected(promise: Promise<unknown>) {
    let error: unknown = null;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(String((error as Error).message)).toContain(
      'reviews_hidden_columns_consistent',
    );
  }

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, { stock: 10 });
    shop = { ...base, variantId: variant.id };
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
  });

  it('đánh giá mới (và mọi đánh giá có từ trước — không backfill) có cả ba cột NULL', async () => {
    const review = await newReview(5);

    expect(review).toMatchObject({
      hiddenAt: null,
      hiddenById: null,
      hiddenReason: null,
    });
  });

  describe('CHECK reviews_hidden_columns_consistent', () => {
    it('ba cột cùng có giá trị thì qua; đặt cả ba về NULL (mở lại) thì qua', async () => {
      const review = await newReview(3);

      await expect(setHidden(review.id, hiddenCols)).resolves.toMatchObject({
        hiddenById: hiddenCols.hiddenById,
      });
      await expect(
        setHidden(review.id, {
          hiddenAt: null,
          hiddenById: null,
          hiddenReason: null,
        }),
      ).resolves.toMatchObject({ hiddenAt: null });
    });

    it.each([
      ['chỉ có hidden_at', { hiddenAt: new Date() }],
      ['chỉ có hidden_by_id', { hiddenById: randomUUID() }],
      ['chỉ có hidden_reason', { hiddenReason: 'Lý do' }],
      [
        'có hidden_at và hidden_by_id nhưng thiếu lý do',
        { hiddenAt: new Date(), hiddenById: randomUUID() },
      ],
      [
        'có hidden_at và lý do nhưng thiếu người ẩn',
        { hiddenAt: new Date(), hiddenReason: 'Lý do' },
      ],
      [
        'có người ẩn và lý do nhưng thiếu mốc',
        { hiddenById: randomUUID(), hiddenReason: 'Lý do' },
      ],
    ])('%s bị từ chối (không để lại hàng nửa vời)', async (_name, data) => {
      const review = await newReview(3);

      await rejected(setHidden(review.id, data));
    });

    it('chỉ xoá hidden_at mà giữ người ẩn / lý do bị từ chối (mở lại phải xoá cả ba)', async () => {
      const review = await newReview(3);
      await setHidden(review.id, hiddenCols);

      await rejected(setHidden(review.id, { hiddenAt: null }));
    });

    it('lý do: rỗng bị từ chối, 1 và đúng 500 ký tự qua, 501 bị từ chối', async () => {
      const review = await newReview(3);

      await rejected(setHidden(review.id, { ...hiddenCols, hiddenReason: '' }));
      await expect(
        setHidden(review.id, { ...hiddenCols, hiddenReason: 'a' }),
      ).resolves.toBeDefined();
      await expect(
        setHidden(review.id, {
          ...hiddenCols,
          hiddenReason: 'a'.repeat(500),
        }),
      ).resolves.toBeDefined();
      await rejected(
        setHidden(review.id, {
          ...hiddenCols,
          hiddenReason: 'a'.repeat(501),
        }),
      );
    });

    it('char_length đếm KÝ TỰ chứ không đếm byte: 500 chữ có dấu 3 byte vẫn qua', async () => {
      const review = await newReview(3);

      await expect(
        setHidden(review.id, { ...hiddenCols, hiddenReason: 'ệ'.repeat(500) }),
      ).resolves.toBeDefined();
    });

    it('người ẩn: rỗng và 65 ký tự bị từ chối, đúng 64 ký tự qua', async () => {
      const review = await newReview(3);

      await rejected(setHidden(review.id, { ...hiddenCols, hiddenById: '' }));
      await rejected(
        setHidden(review.id, { ...hiddenCols, hiddenById: 'a'.repeat(65) }),
      );
      await expect(
        setHidden(review.id, { ...hiddenCols, hiddenById: 'a'.repeat(64) }),
      ).resolves.toBeDefined();
    });

    it('không có khoá ngoại: người ẩn không phải người dùng nào trong bảng users vẫn ghi được (nhật ký sống lâu hơn tài khoản)', async () => {
      const review = await newReview(3);

      await expect(
        setHidden(review.id, { ...hiddenCols, hiddenById: randomUUID() }),
      ).resolves.toBeDefined();
    });
  });

  describe('ProductRatingService.recompute chỉ tính đánh giá đang hiển thị', () => {
    it('ẩn đánh giá ⇒ điểm và số lượng bỏ nó; mở lại ⇒ tính lại đủ', async () => {
      const fresh = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, fresh, { stock: 10 });
      const make = async (stars: number) => {
        const user = await createUser(prisma, TAG);
        const { orderId } = await createOrderWithItem(prisma, {
          userId: user.id,
          shopId: fresh.shopId,
          variantId: variant.id,
        });
        return prisma.review.create({
          data: {
            userId: user.id,
            productId: fresh.productId,
            orderId,
            rating: stars,
          },
        });
      };
      await make(5);
      await make(4);
      const bad = await make(1);
      const recompute = () =>
        prisma.$transaction((tx) => rating.recompute(tx, fresh.productId));

      expect(await recompute()).toEqual({ avgRating: 3.33, reviewCount: 3 });

      await setHidden(bad.id, hiddenCols);
      expect(await recompute()).toEqual({ avgRating: 4.5, reviewCount: 2 });
      expect(
        await prisma.product.findUniqueOrThrow({
          where: { id: fresh.productId },
          select: { avgRating: true, reviewCount: true },
        }),
      ).toEqual({ avgRating: 4.5, reviewCount: 2 });

      await setHidden(bad.id, {
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
      });
      expect(await recompute()).toEqual({ avgRating: 3.33, reviewCount: 3 });
    });

    it('ẩn hết ⇒ avgRating 0 và reviewCount 0', async () => {
      const fresh = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, fresh, { stock: 10 });
      const user = await createUser(prisma, TAG);
      const { orderId } = await createOrderWithItem(prisma, {
        userId: user.id,
        shopId: fresh.shopId,
        variantId: variant.id,
      });
      const only = await prisma.review.create({
        data: {
          userId: user.id,
          productId: fresh.productId,
          orderId,
          rating: 4,
        },
      });
      await setHidden(only.id, hiddenCols);

      const summary = await prisma.$transaction((tx) =>
        rating.recompute(tx, fresh.productId),
      );

      expect(summary).toEqual({ avgRating: 0, reviewCount: 0 });
    });
  });

  describe('chỉ mục phục vụ trang đánh giá công khai', () => {
    // Kiểm DANH MỤC chứ không kiểm kế hoạch (EXPLAIN): trên bảng rỗng / vừa tạo chi phí các chỉ mục hoà nhau nên planner có lúc chọn khoá
    // UNIQUE (user_id, product_id, order_id) rồi lọc `hidden_at` sau — đã đo: ngay sau CREATE INDEX test EXPLAIN đỏ, vài lần chạy sau xanh,
    // tức là phụ thuộc thống kê chứ không phụ thuộc mã. Thứ tự cột mới là thứ đảm bảo `WHERE product_id = ? AND hidden_at IS NULL ORDER BY
    // created_at` quét được trong một khoảng liên tục của chỉ mục; không so TÊN chỉ mục (bài học từ lỗi CI ở chat-read.int-spec).
    async function reviewIndexColumns() {
      const rows = await prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_indexdef(i.indexrelid) AS def
        FROM pg_index i
        WHERE i.indrelid = 'reviews'::regclass`;
      return rows.map(({ def }) => /USING btree \((.*)\)$/.exec(def)?.[1]);
    }

    it('có chỉ mục (product_id, hidden_at, created_at) cho danh sách và phân bố số sao đang hiển thị', async () => {
      expect(await reviewIndexColumns()).toContain(
        'product_id, hidden_at, created_at',
      );
    });

    it('chỉ mục cũ (product_id, created_at) đã được thay, không giữ song song hai chỉ mục dư thừa', async () => {
      expect(await reviewIndexColumns()).not.toContain(
        'product_id, created_at',
      );
    });
  });
});
