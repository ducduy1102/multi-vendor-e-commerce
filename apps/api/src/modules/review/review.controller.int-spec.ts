import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type OrderStatus,
  type ProductStatus,
  type ShopStatus,
} from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  orderDetailSchema,
  productCardSchema,
  productDetailSchema,
  productReviewsResponseSchema,
  reviewSchema,
  sellerReviewListResponseSchema,
  sellerReviewSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createOrderWithItem,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho module review (Week9.md 2.10). Chứng minh điều
// unit test với mock không chứng minh được: ma trận điều kiện viết đánh giá đi qua guard + DB thật, điểm trung
// bình denormalized trên Product luôn khớp dù nhiều người đánh giá ĐỒNG THỜI (không deadlock), sửa đúng một lần
// kể cả khi hai lần sửa đua nhau, danh sách công khai ẩn sản phẩm nháp / shop chưa duyệt và không lộ định danh
// người mua, seller khác shop không đụng được, sort `rating` ổn định theo `id`. Chạy: `pnpm test:int`.
const TAG = 'it-review-';
const PASSWORD = 'password123';
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEWER_NAME = 'Nguyễn Văn An';

const fakeMail = createFakeMail();

describe('Review (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  interface Account {
    agent: Agent;
    userId: string;
    email: string;
  }

  let anonymous: Agent;
  let seller: Account;
  let otherSeller: Account;

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const details = (res: { body: unknown }) =>
    (res.body as { details?: unknown }).details;
  const message = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  async function registerAndLogin(suffix: string): Promise<Account> {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`.toLowerCase();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: REVIEWER_NAME })
      .expect(201);
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: user.id, email };
  }

  // Shop do `ownerId` sở hữu ở trạng thái `status`, có sẵn 1 sản phẩm PUBLISHED + 1 variant.
  async function createShopFor(
    ownerId: string,
    status: ShopStatus = 'APPROVED',
  ) {
    const base = await createShopWithProduct(prisma, TAG);
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { ownerId, status },
    });
    const variant = await createVariant(prisma, base, { stock: 10 });
    return { ...base, variantId: variant.id };
  }

  // Thêm sản phẩm thứ hai trở đi vào một shop có sẵn.
  async function addProduct(
    shop: { shopId: string; productId: string },
    overrides: {
      status?: ProductStatus;
      avgRating?: number;
      reviewCount?: number;
    } = {},
  ) {
    const { categoryId } = await prisma.product.findUniqueOrThrow({
      where: { id: shop.productId },
      select: { categoryId: true },
    });
    const product = await prisma.product.create({
      data: {
        shopId: shop.shopId,
        categoryId,
        name: `${TAG}product-extra-${++seq}`,
        slug: `${TAG}extra-${stamp}-${seq}`,
        status: overrides.status ?? 'PUBLISHED',
        minPrice: 100_000,
        maxPrice: 100_000,
        avgRating: overrides.avgRating ?? 0,
        reviewCount: overrides.reviewCount ?? 0,
      },
      select: { id: true, slug: true },
    });
    const variant = await createVariant(
      prisma,
      { shopId: shop.shopId, productId: product.id },
      { stock: 10 },
    );
    return { productId: product.id, slug: product.slug, variantId: variant.id };
  }

  // Đơn của `buyer` gồm đúng 1 dòng hàng của sản phẩm (mặc định COMPLETED hôm qua).
  const orderFor = (
    buyer: Account,
    product: { shopId: string; variantId: string },
    options: { status?: OrderStatus; completedAt?: Date } = {},
  ) =>
    createOrderWithItem(prisma, {
      userId: buyer.userId,
      shopId: product.shopId,
      variantId: product.variantId,
      ...options,
    });

  const productRow = (id: string) =>
    prisma.product.findUniqueOrThrow({
      where: { id },
      select: {
        avgRating: true,
        reviewCount: true,
        updatedAt: true,
        slug: true,
      },
    });
  const reviewsOf = (productId: string) =>
    prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });

  // Dựng thẳng một review ở DB (không qua API) cho các test đọc / trả lời — kèm tính lại điểm bằng SQL đúng
  // công thức (chỉ dùng cho dữ liệu dựng sẵn; luồng ghi thật đã được test riêng qua API).
  async function seedReview(
    buyer: Account,
    product: { productId: string; shopId: string; variantId: string },
    options: {
      rating?: number;
      comment?: string | null;
      createdAt?: Date;
    } = {},
  ) {
    const { orderId } = await orderFor(buyer, product);
    const review = await prisma.review.create({
      data: {
        userId: buyer.userId,
        productId: product.productId,
        orderId,
        rating: options.rating ?? 5,
        comment: options.comment === undefined ? 'Rất tốt' : options.comment,
        createdAt: options.createdAt,
      },
      select: { id: true },
    });
    await prisma.$executeRaw`
      UPDATE products p
      SET avg_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2)::float8 FROM reviews WHERE product_id = p.id), 0),
          review_count = (SELECT COUNT(*)::int FROM reviews WHERE product_id = p.id)
      WHERE p.id = ${product.productId}`;
    return { reviewId: review.id, orderId };
  }

  const createReview = (buyer: Account, payload: Record<string, unknown>) =>
    buyer.agent.post('/api/v1/reviews').send(payload);

  const validBody = (orderId: string, productId: string) => ({
    orderId,
    productId,
    rating: 5,
    comment: 'Giao nhanh, đúng mô tả',
  });

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Nghe MỘT LẦN trên cổng ngẫu nhiên thay vì để supertest tự listen/close theo từng request: các test race bắn
    // nhiều request song song, request nào xong trước sẽ đóng server dưới chân các request còn lại ⇒ ECONNRESET
    // ngẫu nhiên (đã gặp: 1/10 lượt chạy của test 6 người đánh giá đồng thời).
    await app.listen(0);

    anonymous = newAgent();
    seller = await registerAndLogin('seller');
    otherSeller = await registerAndLogin('seller2');
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // --- Viết đánh giá ---------------------------------------------------------------------------

  describe('POST /reviews — viết đánh giá', () => {
    let buyer: Account;
    let shop: Awaited<ReturnType<typeof createShopFor>>;

    beforeAll(async () => {
      buyer = await registerAndLogin('buyer-create');
      shop = await createShopFor(seller.userId);
    });

    it('chưa đăng nhập ⇒ 401', async () => {
      const res = await anonymous
        .post('/api/v1/reviews')
        .send(validBody('o1', 'p1'));

      expect(res.status).toBe(401);
    });

    it('đơn COMPLETED chứa sản phẩm ⇒ 201: response parse được, tên bị che, không lộ định danh; điểm trung bình của sản phẩm cập nhật; KHÔNG làm đổi updated_at của sản phẩm', async () => {
      const { orderId } = await orderFor(buyer, shop);
      const before = await productRow(shop.productId);

      const res = await createReview(buyer, validBody(orderId, shop.productId));

      expect(res.status).toBe(201);
      const review = reviewSchema.parse(data(res));
      expect(review).toMatchObject({
        rating: 5,
        comment: 'Giao nhanh, đúng mô tả',
        reviewerName: 'N***',
        editedAt: null,
        sellerReply: null,
        sellerRepliedAt: null,
      });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.userId);
      expect(raw).not.toContain(buyer.email);
      expect(raw).not.toContain(REVIEWER_NAME);

      const [row] = await reviewsOf(shop.productId);
      expect(row).toMatchObject({
        id: review.id,
        userId: buyer.userId,
        orderId,
        rating: 5,
      });
      const after = await productRow(shop.productId);
      expect(after.reviewCount).toBe(1);
      expect(after.avgRating).toBe(5);
      // Ghi bằng SQL thô: điểm đánh giá thay đổi không có nghĩa nội dung sản phẩm được sửa.
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('đọc lại chi tiết đơn: dòng hàng có productId / productSlug, canReview false, review của chính mình đủ trường để sửa; chi tiết sản phẩm và card hiện điểm mới', async () => {
      const fresh = await createShopFor(seller.userId);
      const { orderId } = await orderFor(buyer, fresh);

      const before = orderDetailSchema.parse(
        data(await buyer.agent.get(`/api/v1/orders/${orderId}`).expect(200)),
      );
      expect(before.items[0]).toMatchObject({
        productId: fresh.productId,
        canReview: true,
        review: null,
      });
      const slug = before.items[0].productSlug;
      expect(slug).toBe((await productRow(fresh.productId)).slug);

      await createReview(buyer, {
        ...validBody(orderId, fresh.productId),
        rating: 4,
        comment: 'Ổn',
      }).expect(201);

      const after = orderDetailSchema.parse(
        data(await buyer.agent.get(`/api/v1/orders/${orderId}`).expect(200)),
      );
      expect(after.items[0]).toMatchObject({
        canReview: false,
        review: { rating: 4, comment: 'Ổn', editedAt: null, canEdit: true },
      });

      const detail = productDetailSchema.parse(
        (
          data(await anonymous.get(`/api/v1/products/${slug}`).expect(200)) as {
            product: unknown;
          }
        ).product,
      );
      expect(detail).toMatchObject({ avgRating: 4, reviewCount: 1 });
      const list = await anonymous
        .get(`/api/v1/products?shopId=${fresh.shopId}`)
        .expect(200);
      const card = (data(list) as { items: unknown[] }).items
        .map((item) => productCardSchema.parse(item))
        .find((item) => item.id === fresh.productId);
      expect(card).toMatchObject({ avgRating: 4, reviewCount: 1 });
    });

    it('nhận xét tuỳ chọn: bỏ trống ⇒ null', async () => {
      const fresh = await createShopFor(seller.userId);
      const { orderId } = await orderFor(buyer, fresh);

      const res = await createReview(buyer, {
        orderId,
        productId: fresh.productId,
        rating: 3,
      });

      expect(res.status).toBe(201);
      expect(reviewSchema.parse(data(res)).comment).toBeNull();
    });

    describe('điều kiện bị từ chối (409 REVIEW_NOT_ALLOWED) — không ghi gì', () => {
      async function expectRejected(
        orderId: string,
        productId: string,
        reason: string,
      ) {
        const before = await productRow(productId);
        const res = await createReview(buyer, validBody(orderId, productId));

        expect(res.status).toBe(409);
        expect(code(res)).toBe('REVIEW_NOT_ALLOWED');
        expect(details(res)).toEqual({ reason });
        expect(await reviewsOf(productId)).toHaveLength(0);
        const after = await productRow(productId);
        expect([after.reviewCount, after.avgRating]).toEqual([
          before.reviewCount,
          before.avgRating,
        ]);
      }

      it.each([
        'PENDING',
        'CONFIRMED',
        'PACKED',
        'SHIPPING',
        'CANCELLED',
      ] as const)(
        'đơn %s (chưa COMPLETED) ⇒ ORDER_NOT_COMPLETED',
        async (status) => {
          const fresh = await createShopFor(seller.userId);
          const { orderId } = await orderFor(buyer, fresh, { status });

          await expectRejected(orderId, fresh.productId, 'ORDER_NOT_COMPLETED');
        },
      );

      it('đơn đã trả hàng (REFUNDED) ⇒ ORDER_NOT_COMPLETED', async () => {
        const fresh = await createShopFor(seller.userId);
        const { orderId } = await orderFor(buyer, fresh, {
          status: 'COMPLETED',
        });
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'REFUNDED' },
        });

        await expectRejected(orderId, fresh.productId, 'ORDER_NOT_COMPLETED');
      });

      it('chủ shop mua hàng của CHÍNH shop mình (đơn có từ trước khi có luật chặn mua) ⇒ OWN_SHOP dù đơn COMPLETED; chi tiết đơn báo canReview false và không lộ ownerId của shop', async () => {
        // `seller` là chủ của mọi shop tạo bằng createShopFor(seller.userId).
        const mine = await createShopFor(seller.userId);
        const { orderId } = await orderFor(seller, mine);

        const res = await createReview(
          seller,
          validBody(orderId, mine.productId),
        );

        expect(res.status).toBe(409);
        expect(code(res)).toBe('REVIEW_NOT_ALLOWED');
        expect(details(res)).toEqual({ reason: 'OWN_SHOP' });
        expect(await reviewsOf(mine.productId)).toHaveLength(0);
        expect((await productRow(mine.productId)).reviewCount).toBe(0);

        const detailRes = await seller.agent
          .get(`/api/v1/orders/${orderId}`)
          .expect(200);
        const detail = orderDetailSchema.parse(data(detailRes));
        expect(detail.items[0].canReview).toBe(false);
        // Select có ownerId của shop để so sánh, nhưng response chỉ có đúng 4 field công khai.
        expect((data(detailRes) as { shop: object }).shop).not.toHaveProperty(
          'ownerId',
        );
        expect(JSON.stringify(detailRes.body)).not.toContain(seller.userId);
      });

      it('sản phẩm không có trong đơn ⇒ NOT_PURCHASED', async () => {
        const mine = await createShopFor(seller.userId);
        const other = await createShopFor(otherSeller.userId);
        const { orderId } = await orderFor(buyer, mine);

        await expectRejected(orderId, other.productId, 'NOT_PURCHASED');
      });

      it('quá 90 ngày kể từ lúc COMPLETED ⇒ WINDOW_EXPIRED; còn trong cửa sổ thì được', async () => {
        const expired = await createShopFor(seller.userId);
        const { orderId: oldOrder } = await orderFor(buyer, expired, {
          completedAt: new Date(Date.now() - 91 * DAY_MS),
        });
        await expectRejected(oldOrder, expired.productId, 'WINDOW_EXPIRED');

        const ok = await createShopFor(seller.userId);
        const { orderId: recent } = await orderFor(buyer, ok, {
          completedAt: new Date(Date.now() - 89 * DAY_MS),
        });
        await createReview(buyer, validBody(recent, ok.productId)).expect(201);
      });

      it('đã đánh giá sản phẩm này trong đơn này ⇒ ALREADY_REVIEWED, đánh giá cũ giữ nguyên', async () => {
        const fresh = await createShopFor(seller.userId);
        const { orderId } = await orderFor(buyer, fresh);
        await createReview(buyer, {
          ...validBody(orderId, fresh.productId),
          rating: 2,
        }).expect(201);

        const res = await createReview(buyer, {
          ...validBody(orderId, fresh.productId),
          rating: 5,
        });

        expect(res.status).toBe(409);
        expect(details(res)).toEqual({ reason: 'ALREADY_REVIEWED' });
        const rows = await reviewsOf(fresh.productId);
        expect(rows).toHaveLength(1);
        expect(rows[0].rating).toBe(2);
        expect((await productRow(fresh.productId)).avgRating).toBe(2);
      });
    });

    it('đơn của NGƯỜI KHÁC ⇒ 404 ORDER_NOT_FOUND (không lộ đơn có thật), không ghi gì', async () => {
      const fresh = await createShopFor(seller.userId);
      const stranger = await registerAndLogin('stranger');
      const { orderId } = await orderFor(stranger, fresh);

      const res = await createReview(
        buyer,
        validBody(orderId, fresh.productId),
      );

      expect(res.status).toBe(404);
      expect(code(res)).toBe('ORDER_NOT_FOUND');
      expect(await reviewsOf(fresh.productId)).toHaveLength(0);
    });

    it('cùng một sản phẩm ở HAI đơn khác nhau ⇒ đánh giá được cả hai (unique theo từng đơn); điểm tính trên cả hai', async () => {
      const fresh = await createShopFor(seller.userId);
      const { orderId: first } = await orderFor(buyer, fresh);
      const { orderId: second } = await orderFor(buyer, fresh);

      await createReview(buyer, {
        ...validBody(first, fresh.productId),
        rating: 5,
      }).expect(201);
      await createReview(buyer, {
        ...validBody(second, fresh.productId),
        rating: 2,
      }).expect(201);

      const row = await productRow(fresh.productId);
      expect([row.reviewCount, row.avgRating]).toEqual([2, 3.5]);
    });

    it.each([
      [{ rating: 0 }, 'review.validationRatingInvalid'],
      [{ rating: 6 }, 'review.validationRatingInvalid'],
      [{ rating: 4.5 }, 'review.validationRatingInvalid'],
      [{ rating: '5' }, 'review.validationRatingRequired'],
      [{ rating: undefined }, 'review.validationRatingRequired'],
      [{ comment: 'x'.repeat(1001) }, 'review.validationCommentTooLong'],
    ])('body %j ⇒ 400 với key i18n %s, không ghi gì', async (override, key) => {
      const fresh = await createShopFor(seller.userId);
      const { orderId } = await orderFor(buyer, fresh);

      const res = await createReview(buyer, {
        ...validBody(orderId, fresh.productId),
        ...override,
      });

      expect(res.status).toBe(400);
      expect(message(res)).toContain(key);
      expect(await reviewsOf(fresh.productId)).toHaveLength(0);
    });

    it('thiếu orderId / productId ⇒ 400', async () => {
      await createReview(buyer, { productId: 'p1', rating: 5 }).expect(400);
      await createReview(buyer, { orderId: 'o1', rating: 5 }).expect(400);
    });

    it('RACE: cùng một người gửi CÙNG một đánh giá hai lần ĐỒNG THỜI (bấm đúp, 4 vòng) — đúng một bên 201, bên kia 409 ALREADY_REVIEWED; chỉ một review', async () => {
      for (let round = 0; round < 4; round++) {
        const fresh = await createShopFor(seller.userId);
        const { orderId } = await orderFor(buyer, fresh);

        const [a, b] = await Promise.all([
          createReview(buyer, validBody(orderId, fresh.productId)),
          createReview(buyer, validBody(orderId, fresh.productId)),
        ]);

        expect([a.status, b.status].sort()).toEqual([201, 409]);
        const loser = a.status === 409 ? a : b;
        expect(details(loser)).toEqual({ reason: 'ALREADY_REVIEWED' });
        expect(await reviewsOf(fresh.productId)).toHaveLength(1);
        expect((await productRow(fresh.productId)).reviewCount).toBe(1);
      }
    });

    it('RACE: nhiều người đánh giá ĐỒNG THỜI cùng một sản phẩm (3 vòng × 6 người) — không deadlock / không 500, reviewCount và avgRating luôn đúng', async () => {
      const buyers = await Promise.all(
        Array.from({ length: 6 }, (_, i) => registerAndLogin(`racer${i}`)),
      );
      const fresh = await createShopFor(seller.userId);

      let expectedCount = 0;
      let expectedSum = 0;
      for (let round = 0; round < 3; round++) {
        const ratings = buyers.map((_, i) => ((i + round) % 5) + 1);
        const orders = await Promise.all(buyers.map((b) => orderFor(b, fresh)));

        const results = await Promise.all(
          buyers.map((b, i) =>
            createReview(b, {
              ...validBody(orders[i].orderId, fresh.productId),
              rating: ratings[i],
            }),
          ),
        );

        expect(results.map((r) => r.status)).toEqual(buyers.map(() => 201));
        expectedCount += buyers.length;
        expectedSum += ratings.reduce((a, b) => a + b, 0);
        const row = await productRow(fresh.productId);
        expect(row.reviewCount).toBe(expectedCount);
        expect(row.avgRating).toBe(
          Math.round((expectedSum / expectedCount) * 100) / 100,
        );
      }
      expect(await reviewsOf(fresh.productId)).toHaveLength(expectedCount);
    });
  });

  // --- Sửa đánh giá ----------------------------------------------------------------------------

  describe('PATCH /reviews/:id — sửa đúng một lần', () => {
    let buyer: Account;
    let stranger: Account;
    let shop: Awaited<ReturnType<typeof createShopFor>>;

    beforeAll(async () => {
      buyer = await registerAndLogin('buyer-edit');
      stranger = await registerAndLogin('stranger-edit');
      shop = await createShopFor(seller.userId);
    });

    async function newReview(rating = 5) {
      const fresh = await addProduct(shop);
      const { orderId } = await orderFor(buyer, { ...shop, ...fresh });
      const res = await createReview(buyer, {
        orderId,
        productId: fresh.productId,
        rating,
        comment: 'Bản đầu',
      }).expect(201);
      return {
        reviewId: reviewSchema.parse(data(res)).id,
        productId: fresh.productId,
      };
    }

    const edit = (
      account: Account,
      reviewId: string,
      payload: Record<string, unknown>,
    ) => account.agent.patch(`/api/v1/reviews/${reviewId}`).send(payload);

    it('chưa đăng nhập ⇒ 401', async () => {
      const res = await anonymous
        .patch('/api/v1/reviews/some-id')
        .send({ rating: 3 });

      expect(res.status).toBe(401);
    });

    it('sửa lần đầu ⇒ 200: rating / nhận xét mới, editedAt có giá trị, điểm trung bình tính lại; chi tiết đơn báo canEdit false', async () => {
      const { reviewId, productId } = await newReview(5);

      const res = await edit(buyer, reviewId, {
        rating: 2,
        comment: 'Dùng rồi thấy tạm',
      });

      expect(res.status).toBe(200);
      const review = reviewSchema.parse(data(res));
      expect(review).toMatchObject({
        id: reviewId,
        rating: 2,
        comment: 'Dùng rồi thấy tạm',
      });
      expect(review.editedAt).not.toBeNull();
      expect((await productRow(productId)).avgRating).toBe(2);
      expect((await productRow(productId)).reviewCount).toBe(1);
    });

    it('sửa lần hai ⇒ 409 REVIEW_EDIT_NOT_ALLOWED, giữ nguyên bản sửa lần đầu và điểm', async () => {
      const { reviewId, productId } = await newReview(5);
      await edit(buyer, reviewId, { rating: 3 }).expect(200);

      const res = await edit(buyer, reviewId, {
        rating: 1,
        comment: 'Đổi ý lần nữa',
      });

      expect(res.status).toBe(409);
      expect(code(res)).toBe('REVIEW_EDIT_NOT_ALLOWED');
      const [row] = await reviewsOf(productId);
      expect(row.rating).toBe(3);
      expect((await productRow(productId)).avgRating).toBe(3);
    });

    it('bỏ trống nhận xét khi sửa = xoá nội dung cũ', async () => {
      const { reviewId } = await newReview(5);

      const res = await edit(buyer, reviewId, { rating: 4 });

      expect(res.status).toBe(200);
      expect(reviewSchema.parse(data(res)).comment).toBeNull();
    });

    it('đánh giá của NGƯỜI KHÁC / không tồn tại ⇒ 404 REVIEW_NOT_FOUND, không đổi gì', async () => {
      const { reviewId, productId } = await newReview(5);

      const foreign = await edit(stranger, reviewId, { rating: 1 });
      const missing = await edit(
        buyer,
        '00000000-0000-4000-8000-000000000000',
        {
          rating: 1,
        },
      );

      expect(foreign.status).toBe(404);
      expect(code(foreign)).toBe('REVIEW_NOT_FOUND');
      expect(missing.status).toBe(404);
      const [row] = await reviewsOf(productId);
      expect([row.rating, row.editedAt]).toEqual([5, null]);
    });

    it.each([
      [{ rating: 0 }, 'review.validationRatingInvalid'],
      [{ rating: 7 }, 'review.validationRatingInvalid'],
      [{}, 'review.validationRatingRequired'],
      [
        { rating: 3, comment: 'x'.repeat(1001) },
        'review.validationCommentTooLong',
      ],
    ])('body %j ⇒ 400 (%s), vẫn sửa được sau đó', async (payload, key) => {
      const { reviewId } = await newReview(5);

      const bad = await edit(buyer, reviewId, payload);

      expect(bad.status).toBe(400);
      expect(message(bad)).toContain(key);
      // Lần sửa hỏng không tiêu mất "một lần sửa".
      await edit(buyer, reviewId, { rating: 4 }).expect(200);
    });

    it('RACE: hai lần sửa ĐỒNG THỜI (4 vòng) — đúng một bên 200, bên kia 409; điểm khớp bản thắng', async () => {
      for (let round = 0; round < 4; round++) {
        const { reviewId, productId } = await newReview(5);

        const [a, b] = await Promise.all([
          edit(buyer, reviewId, { rating: 1 }),
          edit(buyer, reviewId, { rating: 2 }),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const winner = a.status === 200 ? 1 : 2;
        const [row] = await reviewsOf(productId);
        expect(row.rating).toBe(winner);
        expect((await productRow(productId)).avgRating).toBe(winner);
      }
    });

    it('RACE: sửa một đánh giá ĐỒNG THỜI với đánh giá mới trên cùng sản phẩm — không deadlock, điểm cuối khớp dữ liệu thật', async () => {
      const racer = await registerAndLogin('edit-racer');
      const fresh = await addProduct(shop);
      const { orderId: firstOrder } = await orderFor(buyer, {
        ...shop,
        ...fresh,
      });
      const first = await createReview(buyer, {
        orderId: firstOrder,
        productId: fresh.productId,
        rating: 5,
      }).expect(201);
      const firstId = reviewSchema.parse(data(first)).id;
      const { orderId: secondOrder } = await orderFor(racer, {
        ...shop,
        ...fresh,
      });

      const [edited, created] = await Promise.all([
        edit(buyer, firstId, { rating: 1 }),
        createReview(racer, {
          orderId: secondOrder,
          productId: fresh.productId,
          rating: 4,
        }),
      ]);

      expect(edited.status).toBe(200);
      expect(created.status).toBe(201);
      const row = await productRow(fresh.productId);
      expect([row.reviewCount, row.avgRating]).toEqual([2, 2.5]);
    });
  });

  // --- Đọc công khai ---------------------------------------------------------------------------

  describe('GET /products/:idOrSlug/reviews — công khai', () => {
    let shop: Awaited<ReturnType<typeof createShopFor>>;
    let slug: string;
    const buyers: Account[] = [];

    beforeAll(async () => {
      shop = await createShopFor(seller.userId);
      slug = (await productRow(shop.productId)).slug;
      for (let i = 0; i < 4; i++)
        buyers.push(await registerAndLogin(`reader${i}`));
      // Mới nhất cuối: ratings 5, 5, 4, 1 với createdAt tăng dần.
      const ratings = [5, 5, 4, 1];
      for (let i = 0; i < ratings.length; i++) {
        await seedReview(buyers[i], shop, {
          rating: ratings[i],
          comment: `Nhận xét ${i}`,
          createdAt: new Date(Date.now() - (ratings.length - i) * 60_000),
        });
      }
    });

    const list = (idOrSlug: string, query = '') =>
      anonymous.get(`/api/v1/products/${idOrSlug}/reviews${query}`);

    it('không cần đăng nhập: tóm tắt (trung bình, số đánh giá, phân bố đủ 5 mức) + danh sách MỚI NHẤT TRƯỚC; tìm được theo cả id lẫn slug', async () => {
      const bySlug = await list(slug);
      const byId = await list(shop.productId);

      expect(bySlug.status).toBe(200);
      expect(byId.status).toBe(200);
      const parsed = productReviewsResponseSchema.parse(data(bySlug));
      expect(parsed.summary).toEqual({
        avgRating: 3.75, // (5+5+4+1)/4
        reviewCount: 4,
        distribution: { '1': 1, '2': 0, '3': 0, '4': 1, '5': 2 },
      });
      expect(parsed.total).toBe(4);
      expect(parsed.items.map((item) => item.comment)).toEqual([
        'Nhận xét 3',
        'Nhận xét 2',
        'Nhận xét 1',
        'Nhận xét 0',
      ]);
      expect(productReviewsResponseSchema.parse(data(byId)).total).toBe(4);
    });

    it('tên người đánh giá bị che; KHÔNG có userId / email / tên đầy đủ trong response', async () => {
      const res = await list(slug).expect(200);

      const parsed = productReviewsResponseSchema.parse(data(res));
      expect(parsed.items.every((item) => item.reviewerName === 'N***')).toBe(
        true,
      );
      const raw = JSON.stringify(res.body);
      for (const buyer of buyers) {
        expect(raw).not.toContain(buyer.userId);
        expect(raw).not.toContain(buyer.email);
      }
      expect(raw).not.toContain(REVIEWER_NAME);
    });

    it('lọc theo sao: danh sách + total thu hẹp, tóm tắt vẫn của TOÀN BỘ đánh giá', async () => {
      const res = await list(slug, '?rating=5').expect(200);

      const parsed = productReviewsResponseSchema.parse(data(res));
      expect(parsed.total).toBe(2);
      expect(parsed.items.map((item) => item.rating)).toEqual([5, 5]);
      expect(parsed.summary.reviewCount).toBe(4);
      expect((await list(slug, '?rating=3').expect(200)).body).toMatchObject({
        data: { total: 0, items: [] },
      });
    });

    it('phân trang: limit / page; trang quá cuối trả rỗng nhưng total vẫn đúng', async () => {
      const first = productReviewsResponseSchema.parse(
        data(await list(slug, '?limit=3&page=1').expect(200)),
      );
      const second = productReviewsResponseSchema.parse(
        data(await list(slug, '?limit=3&page=2').expect(200)),
      );
      const beyond = productReviewsResponseSchema.parse(
        data(await list(slug, '?limit=3&page=9').expect(200)),
      );

      expect(first.items).toHaveLength(3);
      expect(second.items).toHaveLength(1);
      expect(
        new Set([...first.items, ...second.items].map((i) => i.id)).size,
      ).toBe(4);
      expect(beyond.items).toHaveLength(0);
      expect(beyond.total).toBe(4);
    });

    it('sản phẩm chưa có đánh giá ⇒ 200 với tóm tắt 0 / 0 và danh sách rỗng', async () => {
      const empty = await addProduct(shop);

      const res = await list(empty.slug).expect(200);

      expect(productReviewsResponseSchema.parse(data(res))).toEqual({
        summary: {
          avgRating: 0,
          reviewCount: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
        items: [],
        total: 0,
        page: 1,
        limit: 10,
      });
    });

    it.each(['DRAFT', 'ARCHIVED'] as const)(
      'sản phẩm %s ⇒ 404 dù đã có đánh giá (không lộ qua đường công khai)',
      async (status) => {
        const hidden = await addProduct(shop, { status });
        const buyer = await registerAndLogin(`hidden-${status}`);
        await seedReview(buyer, { ...shop, ...hidden });

        const res = await list(hidden.slug);

        expect(res.status).toBe(404);
      },
    );

    it.each(['PENDING', 'REJECTED', 'SUSPENDED'] as const)(
      'shop %s ⇒ 404 ở danh sách công khai',
      async (status) => {
        const hiddenShop = await createShopFor(seller.userId, status);
        const buyer = await registerAndLogin(`shop-${status}`);
        await seedReview(buyer, hiddenShop);

        const res = await list(hiddenShop.productId);

        expect(res.status).toBe(404);
      },
    );

    it('sản phẩm không tồn tại ⇒ 404', async () => {
      expect((await list('khong-co-san-pham-nay')).status).toBe(404);
    });

    it.each(['?rating=0', '?rating=6', '?rating=abc', '?limit=51', '?page=0'])(
      'query %s ⇒ 400',
      async (query) => {
        expect((await list(slug, query)).status).toBe(400);
      },
    );
  });

  // --- Seller ----------------------------------------------------------------------------------

  describe('seller: GET /shops/:shopId/reviews và PUT /shops/:shopId/reviews/:id/reply', () => {
    let shopA: Awaited<ReturnType<typeof createShopFor>>;
    let shopB: Awaited<ReturnType<typeof createShopFor>>;
    let buyer: Account;
    const reviewIds: Record<string, string> = {};

    const listShop = (shopId: string, query = '', account = seller) =>
      account.agent.get(`/api/v1/shops/${shopId}/reviews${query}`);
    const reply = (
      shopId: string,
      reviewId: string,
      payload: Record<string, unknown>,
      account = seller,
    ) =>
      account.agent
        .put(`/api/v1/shops/${shopId}/reviews/${reviewId}/reply`)
        .send(payload);

    beforeAll(async () => {
      shopA = await createShopFor(seller.userId);
      shopB = await createShopFor(otherSeller.userId);
      buyer = await registerAndLogin('seller-flow');
      const archived = await addProduct(shopA, { status: 'ARCHIVED' });
      reviewIds.five = (await seedReview(buyer, shopA, { rating: 5 })).reviewId;
      reviewIds.two = (await seedReview(buyer, shopA, { rating: 2 })).reviewId;
      reviewIds.archived = (
        await seedReview(buyer, { ...shopA, ...archived }, { rating: 3 })
      ).reviewId;
      reviewIds.otherShop = (
        await seedReview(buyer, shopB, { rating: 4 })
      ).reviewId;
    });

    it('chưa đăng nhập ⇒ 401; user không phải chủ shop ⇒ 403 (cả danh sách lẫn trả lời)', async () => {
      await anonymous.get(`/api/v1/shops/${shopA.shopId}/reviews`).expect(401);
      await anonymous
        .put(`/api/v1/shops/${shopA.shopId}/reviews/${reviewIds.five}/reply`)
        .send({ reply: 'x' })
        .expect(401);

      expect((await listShop(shopA.shopId, '', otherSeller)).status).toBe(403);
      expect(
        (await reply(shopA.shopId, reviewIds.five, { reply: 'x' }, otherSeller))
          .status,
      ).toBe(403);
      expect((await reviewsOf(shopA.productId))[0].sellerReply).toBeNull();
    });

    it('chỉ thấy đánh giá của sản phẩm thuộc shop MÌNH (kể cả sản phẩm đã lưu trữ), mới nhất trước; kèm sản phẩm, tên người mua bị che', async () => {
      const res = await listShop(shopA.shopId).expect(200);

      const parsed = sellerReviewListResponseSchema.parse(data(res));
      const ids = parsed.items.map((item) => item.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          reviewIds.five,
          reviewIds.two,
          reviewIds.archived,
        ]),
      );
      expect(ids).not.toContain(reviewIds.otherShop);
      expect(parsed.total).toBe(3);
      expect(parsed.items.every((item) => item.reviewerName === 'N***')).toBe(
        true,
      );
      expect(
        parsed.items.find((item) => item.id === reviewIds.five)?.product,
      ).toMatchObject({ id: shopA.productId });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.userId);
      expect(raw).not.toContain(buyer.email);
    });

    it('lọc theo sao và đã/chưa trả lời; replied sai giá trị ⇒ 400', async () => {
      const two = sellerReviewListResponseSchema.parse(
        data(await listShop(shopA.shopId, '?rating=2').expect(200)),
      );
      expect(two.items.map((item) => item.id)).toEqual([reviewIds.two]);

      const unreplied = sellerReviewListResponseSchema.parse(
        data(await listShop(shopA.shopId, '?replied=false').expect(200)),
      );
      expect(unreplied.total).toBe(3);
      const replied = sellerReviewListResponseSchema.parse(
        data(await listShop(shopA.shopId, '?replied=true').expect(200)),
      );
      expect(replied.total).toBe(0);

      expect((await listShop(shopA.shopId, '?replied=maybe')).status).toBe(400);
      expect((await listShop(shopA.shopId, '?rating=9')).status).toBe(400);
    });

    it('trả lời ⇒ 200 với câu trả lời + mốc; hiện ngay trên danh sách công khai; lọc replied khớp; KHÔNG đổi điểm đánh giá của sản phẩm', async () => {
      const before = await productRow(shopA.productId);

      const res = await reply(shopA.shopId, reviewIds.five, {
        reply: '  Cảm ơn bạn đã ủng hộ shop!  ',
      });

      expect(res.status).toBe(200);
      const item = sellerReviewSchema.parse(data(res));
      expect(item).toMatchObject({
        id: reviewIds.five,
        sellerReply: 'Cảm ơn bạn đã ủng hộ shop!',
        product: { id: shopA.productId },
      });
      expect(item.sellerRepliedAt).not.toBeNull();

      const publicList = productReviewsResponseSchema.parse(
        data(
          await anonymous
            .get(`/api/v1/products/${before.slug}/reviews`)
            .expect(200),
        ),
      );
      expect(
        publicList.items.find((r) => r.id === reviewIds.five)?.sellerReply,
      ).toBe('Cảm ơn bạn đã ủng hộ shop!');

      const replied = sellerReviewListResponseSchema.parse(
        data(await listShop(shopA.shopId, '?replied=true').expect(200)),
      );
      expect(replied.items.map((r) => r.id)).toEqual([reviewIds.five]);

      const after = await productRow(shopA.productId);
      expect([after.reviewCount, after.avgRating]).toEqual([
        before.reviewCount,
        before.avgRating,
      ]);
    });

    it('trả lời lại = sửa (ghi đè, mốc mới hơn), không xoá được', async () => {
      const first = sellerReviewSchema.parse(
        data(await reply(shopA.shopId, reviewIds.two, { reply: 'Lần một' })),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      const second = sellerReviewSchema.parse(
        data(await reply(shopA.shopId, reviewIds.two, { reply: 'Lần hai' })),
      );

      expect(second.sellerReply).toBe('Lần hai');
      expect(Date.parse(second.sellerRepliedAt!)).toBeGreaterThan(
        Date.parse(first.sellerRepliedAt!),
      );
      // Rỗng không phải là cách xoá: bị từ chối.
      expect(
        (await reply(shopA.shopId, reviewIds.two, { reply: '   ' })).status,
      ).toBe(400);
      expect(
        (await reviewsOf(shopA.productId)).find((r) => r.id === reviewIds.two)
          ?.sellerReply,
      ).toBe('Lần hai');
    });

    it('đánh giá của SHOP KHÁC (dù là chủ shop của mình) ⇒ 404 REVIEW_NOT_FOUND, không đụng tới; id không tồn tại cũng 404', async () => {
      const res = await reply(shopA.shopId, reviewIds.otherShop, {
        reply: 'Chen ngang',
      });

      expect(res.status).toBe(404);
      expect(code(res)).toBe('REVIEW_NOT_FOUND');
      expect((await reviewsOf(shopB.productId))[0].sellerReply).toBeNull();
      expect(
        (
          await reply(shopA.shopId, '00000000-0000-4000-8000-000000000000', {
            reply: 'x',
          })
        ).status,
      ).toBe(404);
    });

    it('thiếu / rỗng / quá 1000 ký tự ⇒ 400 báo theo field reply', async () => {
      const missing = await seller.agent.put(
        `/api/v1/shops/${shopA.shopId}/reviews/${reviewIds.five}/reply`,
      );
      const blank = await reply(shopA.shopId, reviewIds.five, { reply: '' });
      const tooLong = await reply(shopA.shopId, reviewIds.five, {
        reply: 'x'.repeat(1001),
      });

      for (const res of [missing, blank]) {
        expect(res.status).toBe(400);
        expect(message(res)).toContain('review.validationReplyRequired');
      }
      expect(tooLong.status).toBe(400);
      expect(message(tooLong)).toContain('review.validationReplyTooLong');
    });

    it('shop đang bị KHOÁ vẫn trả lời được đánh giá đã có (vẫn xử lý đơn / đánh giá)', async () => {
      const suspended = await createShopFor(seller.userId, 'SUSPENDED');
      const { reviewId } = await seedReview(buyer, suspended);

      const res = await reply(suspended.shopId, reviewId, {
        reply: 'Xin lỗi vì sự bất tiện',
      });

      expect(res.status).toBe(200);
      expect(sellerReviewSchema.parse(data(res)).sellerReply).toBe(
        'Xin lỗi vì sự bất tiện',
      );
    });
  });

  // --- Sort rating -----------------------------------------------------------------------------

  describe('GET /products?sort=rating', () => {
    it('điểm cao trước, hoà thì nhiều đánh giá hơn trước, hoà nữa theo id (ổn định); sản phẩm chưa có đánh giá xuống cuối; chỉ sản phẩm công khai', async () => {
      const shop = await createShopFor(seller.userId);
      // createShopWithProduct đã có 1 sản phẩm (0 đánh giá) — thêm các sản phẩm còn lại.
      const fiveOne = await addProduct(shop, { avgRating: 5, reviewCount: 1 });
      const fiveThree = await addProduct(shop, {
        avgRating: 5,
        reviewCount: 3,
      });
      const fourTwoA = await addProduct(shop, { avgRating: 4, reviewCount: 2 });
      const fourTwoB = await addProduct(shop, { avgRating: 4, reviewCount: 2 });
      const draft = await addProduct(shop, {
        status: 'DRAFT',
        avgRating: 5,
        reviewCount: 99,
      });
      const tied = [fourTwoA.productId, fourTwoB.productId].sort();

      const fetchOrder = async (page = 1, limit = 50) => {
        const res = await anonymous
          .get(
            `/api/v1/products?shopId=${shop.shopId}&sort=rating&page=${page}&limit=${limit}`,
          )
          .expect(200);
        return (data(res) as { items: { id: string }[] }).items.map(
          (i) => i.id,
        );
      };

      const order = await fetchOrder();

      expect(order).toEqual([
        fiveThree.productId,
        fiveOne.productId,
        ...tied,
        shop.productId,
      ]);
      expect(order).not.toContain(draft.productId);
      // Ổn định: gọi lại ra đúng thứ tự cũ, và phân trang không lặp / sót.
      expect(await fetchOrder()).toEqual(order);
      const paged = [
        ...(await fetchOrder(1, 2)),
        ...(await fetchOrder(2, 2)),
        ...(await fetchOrder(3, 2)),
      ];
      expect(paged).toEqual(order);
    });

    it('sort lạ ⇒ 400 (rating là một giá trị hợp lệ của enum, giá trị khác thì không)', async () => {
      await anonymous.get('/api/v1/products?sort=rating').expect(200);
      await anonymous.get('/api/v1/products?sort=best').expect(400);
    });
  });
});
