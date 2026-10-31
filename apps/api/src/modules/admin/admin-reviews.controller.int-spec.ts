import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  productReviewsResponseSchema,
  REVIEW_HIDDEN_REASON_MAX_LENGTH,
  reviewModerationResponseSchema,
  sellerReviewListResponseSchema,
} from '@ecommerce/types';
import { seedAdmin } from '../../../prisma/seed-admin';
import { AppModule } from '../../app.module';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createOrderWithItem,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho ẩn / hiện đánh giá của Admin (Week11.md 5.5, D6). Chứng minh điều
// unit test với mock không chứng minh được: điểm trung bình và số đánh giá denormalized trên Product khớp từng bước với tập đánh giá
// ĐANG HIỂN THỊ (kể cả khi ẩn đánh giá cuối cùng ⇒ 0), đánh giá ẩn biến khỏi trang sản phẩm công khai và danh sách seller, tác giả vẫn
// thấy bản của mình kèm cờ nhưng không sửa được, ẩn / hiện / sửa đua nhau không làm lệch điểm, ẩn là một giao dịch với nhật ký, và lý do
// của Admin không lọt ra ngoài. Chạy: `pnpm test:int`.
const TAG = 'it-admin-reviews-';
const PASSWORD = 'password123';
const NUL = String.fromCharCode(0);
const REASON = 'Ngôn từ xúc phạm, vi phạm quy định cộng đồng';
const fakeMail = createFakeMail();

describe('Ẩn / hiện đánh giá của Admin (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;
  const startedAt = new Date();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let adminId: string;
  let admin2: Agent;
  let anonymous: Agent;

  const observed = { hide: new Set<number>(), unhide: new Set<number>() };

  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const dataOf = (res: { body: unknown }) =>
    (res.body as { data: unknown }).data;

  interface Account {
    agent: Agent;
    userId: string;
    email: string;
  }

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function newAccount(): Promise<Account> {
    const n = counter++;
    const email = `${TAG}${stamp}-${n}@test.local`;
    const agent = newAgent();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}user${n}` })
      .expect(201);
    const user = await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
      select: { id: true },
    });
    await loginAs(agent, email);
    return { agent, userId: user.id, email };
  }

  interface Store {
    owner: Account;
    shopId: string;
    productId: string;
    productSlug: string;
    variantId: string;
  }

  async function newStore(): Promise<Store> {
    const owner = await newAccount();
    const n = counter++;
    const category = await prisma.category.create({
      data: {
        name: `${TAG}cat${n}`,
        slug: `${TAG}cat-${stamp.toString(36)}-${n}`,
      },
      select: { id: true },
    });
    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.userId,
        name: `${TAG}shop${n}`,
        slug: `${TAG}shop-${stamp.toString(36)}-${n}`,
        status: 'APPROVED',
      },
      select: { id: true },
    });
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: category.id,
        name: `${TAG}product${n}`,
        slug: `${TAG}product-${stamp.toString(36)}-${n}`,
        status: 'PUBLISHED',
        minPrice: 100000,
        maxPrice: 100000,
      },
      select: { id: true, slug: true },
    });
    const variant = await createVariant(
      prisma,
      { shopId: shop.id, productId: product.id },
      { stock: 10 },
    );
    return {
      owner,
      shopId: shop.id,
      productId: product.id,
      productSlug: product.slug,
      variantId: variant.id,
    };
  }

  // Đánh giá THẬT qua API (đơn COMPLETED hôm qua → POST /reviews), nên điểm denormalized được ghi đúng đường thật.
  async function review(
    store: Store,
    rating: number,
    options: { comment?: string; status?: 'COMPLETED' | 'REFUNDED' } = {},
  ) {
    const buyer = await newAccount();
    const { orderId } = await createOrderWithItem(prisma, {
      userId: buyer.userId,
      shopId: store.shopId,
      variantId: store.variantId,
      status: options.status,
    });
    if (options.status && options.status !== 'COMPLETED') {
      // Đơn đã hoàn tiền không còn viết đánh giá mới được; dựng thẳng đánh giá có từ trước khi hoàn.
      const created = await prisma.review.create({
        data: {
          userId: buyer.userId,
          productId: store.productId,
          orderId,
          rating,
          comment: options.comment ?? 'Tạm',
        },
        select: { id: true },
      });
      await recomputeFromDb(store.productId);
      return { buyer, orderId, reviewId: created.id };
    }
    const res = await buyer.agent.post('/api/v1/reviews').send({
      orderId,
      productId: store.productId,
      rating,
      ...(options.comment ? { comment: options.comment } : {}),
    });
    expect(res.status).toBe(201);
    return {
      buyer,
      orderId,
      reviewId: (dataOf(res) as { id: string }).id,
    };
  }

  // Điểm "đúng" tính thẳng từ tập đánh giá ĐANG HIỂN THỊ — đối chứng độc lập với ProductRatingService.
  async function expectedAggregate(productId: string) {
    const [row] = await prisma.$queryRaw<{ avg: number; count: number }[]>`
      SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::float8 AS avg, COUNT(*)::int AS count
      FROM reviews WHERE product_id = ${productId} AND hidden_at IS NULL`;
    return { avgRating: row.avg, reviewCount: row.count };
  }
  async function recomputeFromDb(productId: string) {
    const expected = await expectedAggregate(productId);
    await prisma.$executeRaw`
      UPDATE products SET avg_rating = ${expected.avgRating}::float8, review_count = ${expected.reviewCount}::int
      WHERE id = ${productId}`;
  }
  const productRow = (id: string) =>
    prisma.product.findUniqueOrThrow({
      where: { id },
      select: { avgRating: true, reviewCount: true },
    });
  const reviewRow = (id: string) =>
    prisma.review.findUniqueOrThrow({ where: { id } });

  const hideUrl = (id: string) => `/api/v1/admin/reviews/${id}/hide`;
  const unhideUrl = (id: string) => `/api/v1/admin/reviews/${id}/unhide`;
  async function hide(
    agent: Agent,
    id: string,
    body: unknown = { reason: REASON },
  ) {
    const res = await agent.post(hideUrl(id)).send(body as object);
    observed.hide.add(res.status);
    return res;
  }
  async function unhide(
    agent: Agent,
    id: string,
    body: unknown = { reason: REASON },
  ) {
    const res = await agent.post(unhideUrl(id)).send(body as object);
    observed.unhide.add(res.status);
    return res;
  }
  const auditRows = (action: string, targetId: string) =>
    prisma.adminAuditLog.findMany({ where: { action, targetId } });
  const notificationsOf = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type } });

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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): tránh ECONNRESET khi có request song song.
    await app.listen(0);

    const email = `${TAG}${stamp}admin@test.local`;
    await seedAdmin(prisma, { email, password: PASSWORD });
    admin = newAgent();
    await loginAs(admin, email);
    adminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;
    const email2 = `${TAG}${stamp}admin2@test.local`;
    await seedAdmin(prisma, { email: email2, password: PASSWORD });
    admin2 = newAgent();
    await loginAs(admin2, email2);
    anonymous = newAgent();
  });

  afterEach(() => {
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401; người dùng thường và chủ shop 403; đánh giá không bị đụng tới', async () => {
      const store = await newStore();
      const { buyer, reviewId } = await review(store, 3);

      const anon = await Promise.all([
        anonymous.post(hideUrl(reviewId)).send({ reason: REASON }),
        anonymous.post(unhideUrl(reviewId)).send({ reason: REASON }),
      ]);
      const forbidden = await Promise.all(
        [buyer, store.owner].flatMap((who) => [
          who.agent.post(hideUrl(reviewId)).send({ reason: REASON }),
          who.agent.post(unhideUrl(reviewId)).send({ reason: REASON }),
        ]),
      );

      expect(anon.map((r) => r.status)).toEqual([401, 401]);
      expect(forbidden.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect((await reviewRow(reviewId)).hiddenAt).toBeNull();
    });

    it.each([
      ['thiếu lý do', {}],
      ['lý do rỗng', { reason: '' }],
      ['lý do toàn khoảng trắng', { reason: '   ' }],
      [
        'lý do quá 500 ký tự',
        { reason: 'a'.repeat(REVIEW_HIDDEN_REASON_MAX_LENGTH + 1) },
      ],
      ['lý do có ký tự điều khiển', { reason: `a${NUL}b` }],
    ])('%s ⇒ 400 và đánh giá không đổi', async (_name, body) => {
      const store = await newStore();
      const { reviewId } = await review(store, 3);

      const res = await hide(admin, reviewId, body);

      expect(res.status).toBe(400);
      expect((await reviewRow(reviewId)).hiddenAt).toBeNull();
    });

    it('đánh giá không tồn tại hoặc id sai dạng ⇒ cùng một 404 REVIEW_NOT_FOUND', async () => {
      const missing = await hide(admin, randomUUID());
      const malformed = await hide(admin, 'not-a-uuid');
      // Id chứa NUL: Postgres không nhận, nếu lọt xuống DB sẽ thành 500 thay vì 404.
      const withNul = await hide(admin, encodeURIComponent(`a${NUL}b`));
      const unhideWithNul = await unhide(admin, encodeURIComponent(`a${NUL}b`));
      const unhideMissing = await unhide(admin, randomUUID());

      expect([missing.status, code(missing)]).toEqual([
        404,
        'REVIEW_NOT_FOUND',
      ]);
      expect(malformed.body).toEqual(missing.body);
      expect(withNul.status).toBe(404);
      expect(withNul.body).toEqual(missing.body);
      expect(unhideWithNul.status).toBe(404);
      expect([unhideMissing.status, code(unhideMissing)]).toEqual([
        404,
        'REVIEW_NOT_FOUND',
      ]);
    });
  });

  describe('điểm đánh giá của sản phẩm', () => {
    it('ẩn rồi mở lại: avgRating và reviewCount khớp tay từng bước (5, 4, 1 ⇒ ẩn sao 1 ⇒ 4,5 / 2 ⇒ mở lại ⇒ 3,33 / 3)', async () => {
      const store = await newStore();
      await review(store, 5);
      await review(store, 4);
      const low = await review(store, 1);
      expect(await productRow(store.productId)).toEqual({
        avgRating: 3.33,
        reviewCount: 3,
      });

      const hidden = await hide(admin, low.reviewId);

      expect(hidden.status).toBe(200);
      expect(
        reviewModerationResponseSchema.parse(dataOf(hidden)).review,
      ).toMatchObject({
        id: low.reviewId,
        isHidden: true,
      });
      expect(await productRow(store.productId)).toEqual({
        avgRating: 4.5,
        reviewCount: 2,
      });
      expect(await productRow(store.productId)).toEqual(
        await expectedAggregate(store.productId),
      );

      const restored = await unhide(admin, low.reviewId);

      expect(restored.status).toBe(200);
      expect(
        reviewModerationResponseSchema.parse(dataOf(restored)).review,
      ).toEqual({
        id: low.reviewId,
        isHidden: false,
        hiddenAt: null,
      });
      expect(await productRow(store.productId)).toEqual({
        avgRating: 3.33,
        reviewCount: 3,
      });
    });

    it('ẩn đánh giá DUY NHẤT còn lại ⇒ avgRating 0 và reviewCount 0; mở lại ⇒ trở về', async () => {
      const store = await newStore();
      const only = await review(store, 4);

      await hide(admin, only.reviewId);
      expect(await productRow(store.productId)).toEqual({
        avgRating: 0,
        reviewCount: 0,
      });

      await unhide(admin, only.reviewId);
      expect(await productRow(store.productId)).toEqual({
        avgRating: 4,
        reviewCount: 1,
      });
    });

    it('trang đánh giá công khai: đánh giá ẩn biến khỏi danh sách, phân bố và tóm tắt (mở lại thì hiện lại)', async () => {
      const store = await newStore();
      await review(store, 5, { comment: 'Rất tốt' });
      const bad = await review(store, 1, { comment: 'NOI-DUNG-BI-AN' });

      await hide(admin, bad.reviewId);
      const afterHide = productReviewsResponseSchema.parse(
        dataOf(
          await anonymous.get(`/api/v1/products/${store.productSlug}/reviews`),
        ),
      );

      expect(afterHide.items.map((item) => item.id)).not.toContain(
        bad.reviewId,
      );
      expect(JSON.stringify(afterHide)).not.toContain('NOI-DUNG-BI-AN');
      // Lý do chỉ dành cho tác giả và chủ shop, không bao giờ ra trang công khai.
      expect(JSON.stringify(afterHide)).not.toContain(REASON);
      expect(afterHide.summary).toMatchObject({ avgRating: 5, reviewCount: 1 });
      expect(afterHide.summary.distribution['1']).toBe(0);
      expect(afterHide.total).toBe(1);

      await unhide(admin, bad.reviewId);
      const afterUnhide = productReviewsResponseSchema.parse(
        dataOf(
          await anonymous.get(`/api/v1/products/${store.productSlug}/reviews`),
        ),
      );
      expect(afterUnhide.items.map((item) => item.id)).toContain(bad.reviewId);
      expect(afterUnhide.summary.reviewCount).toBe(2);
    });

    it('lọc theo số sao không lộ đánh giá ẩn và total khớp', async () => {
      const store = await newStore();
      const one = await review(store, 1);
      await review(store, 1);
      await hide(admin, one.reviewId);

      const res = productReviewsResponseSchema.parse(
        dataOf(
          await anonymous.get(
            `/api/v1/products/${store.productSlug}/reviews?rating=1`,
          ),
        ),
      );

      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    it('đơn đã hoàn tiền (REFUNDED) vẫn giữ đánh giá; ẩn không đụng tới đơn', async () => {
      const store = await newStore();
      const refunded = await review(store, 2, { status: 'REFUNDED' });
      expect(await productRow(store.productId)).toEqual({
        avgRating: 2,
        reviewCount: 1,
      });

      await hide(admin, refunded.reviewId);

      expect((await reviewRow(refunded.reviewId)).orderId).toBe(
        refunded.orderId,
      );
      expect(
        (
          await prisma.order.findUniqueOrThrow({
            where: { id: refunded.orderId },
          })
        ).status,
      ).toBe('REFUNDED');
      expect(await productRow(store.productId)).toEqual({
        avgRating: 0,
        reviewCount: 0,
      });
    });
  });

  describe('seller và tác giả', () => {
    it('đánh giá ẩn là DÒNG TRẠNG THÁI trong danh sách của seller (kèm lý do Admin, KHÔNG nội dung); không trả lời được (409); mở lại thì trở về như cũ', async () => {
      const store = await newStore();
      const target = await review(store, 2, { comment: 'NOI-DUNG-BI-AN' });
      const replied = await store.owner.agent
        .put(`/api/v1/shops/${store.shopId}/reviews/${target.reviewId}/reply`)
        .send({ reply: 'Xin lỗi bạn' });
      expect(replied.status).toBe(200);
      await hide(admin, target.reviewId, {
        reason: 'Ngôn từ xúc phạm người bán',
      });

      const list = sellerReviewListResponseSchema.parse(
        dataOf(
          await store.owner.agent.get(`/api/v1/shops/${store.shopId}/reviews`),
        ),
      );
      const reply = await store.owner.agent
        .put(`/api/v1/shops/${store.shopId}/reviews/${target.reviewId}/reply`)
        .send({ reply: 'Sửa lời trả lời' });

      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({
        id: target.reviewId,
        isHidden: true,
        hiddenReason: 'Ngôn từ xúc phạm người bán',
        comment: null,
        sellerReply: 'Xin lỗi bạn',
      });
      // Shop biết lý do nhưng không biết Admin nào quyết định, và nội dung đã ẩn không được trả lại.
      expect(JSON.stringify(list)).not.toMatch(
        /NOI-DUNG-BI-AN|hiddenById|hiddenAt/,
      );
      expect(JSON.stringify(list)).not.toContain(adminId);
      expect([reply.status, code(reply)]).toEqual([409, 'REVIEW_HIDDEN']);
      expect((await reviewRow(target.reviewId)).sellerReply).toBe(
        'Xin lỗi bạn',
      );

      await unhide(admin, target.reviewId);
      const after = sellerReviewListResponseSchema.parse(
        dataOf(
          await store.owner.agent.get(`/api/v1/shops/${store.shopId}/reviews`),
        ),
      );
      expect(after.items[0]).toMatchObject({
        id: target.reviewId,
        isHidden: false,
        hiddenReason: null,
        comment: 'NOI-DUNG-BI-AN',
        sellerReply: 'Xin lỗi bạn',
      });
    });

    it('tab "Chưa trả lời" là hàng việc cần làm: đánh giá ẩn chưa trả lời không nằm trong đó, nhưng vẫn ở danh sách đầy đủ', async () => {
      const store = await newStore();
      const hiddenOne = await review(store, 1);
      const pending = await review(store, 3);
      await hide(admin, hiddenOne.reviewId);

      const get = async (query: string) =>
        sellerReviewListResponseSchema.parse(
          dataOf(
            await store.owner.agent.get(
              `/api/v1/shops/${store.shopId}/reviews${query}`,
            ),
          ),
        );
      const all = await get('');
      const unreplied = await get('?replied=false');

      expect(all.items.map((item) => item.id).sort()).toEqual(
        [hiddenOne.reviewId, pending.reviewId].sort(),
      );
      expect(unreplied.items.map((item) => item.id)).toEqual([
        pending.reviewId,
      ]);
      expect(unreplied.total).toBe(1);
    });

    it('trả lời đánh giá ẩn của shop KHÁC vẫn là 404 (không lộ nó có thật hay đã ẩn)', async () => {
      const mine = await newStore();
      const theirs = await newStore();
      const target = await review(theirs, 1);
      await hide(admin, target.reviewId);

      const res = await mine.owner.agent
        .put(`/api/v1/shops/${mine.shopId}/reviews/${target.reviewId}/reply`)
        .send({ reply: 'Thử' });
      const missing = await mine.owner.agent
        .put(`/api/v1/shops/${mine.shopId}/reviews/${randomUUID()}/reply`)
        .send({ reply: 'Thử' });

      expect([res.status, code(res)]).toEqual([404, 'REVIEW_NOT_FOUND']);
      expect(res.body).toEqual(missing.body);
    });

    it('tác giả sửa đánh giá đã ẩn ⇒ 409 REVIEW_HIDDEN và nội dung không đổi; sau khi mở lại sửa được một lần', async () => {
      const store = await newStore();
      const mine = await review(store, 1, { comment: 'Tệ' });
      await hide(admin, mine.reviewId);

      const blocked = await mine.buyer.agent
        .patch(`/api/v1/reviews/${mine.reviewId}`)
        .send({ rating: 5, comment: 'Đã đổi ý' });

      expect([blocked.status, code(blocked)]).toEqual([409, 'REVIEW_HIDDEN']);
      expect(await reviewRow(mine.reviewId)).toMatchObject({
        rating: 1,
        comment: 'Tệ',
        editedAt: null,
      });

      await unhide(admin, mine.reviewId);
      const allowed = await mine.buyer.agent
        .patch(`/api/v1/reviews/${mine.reviewId}`)
        .send({ rating: 5, comment: 'Đã đổi ý' });

      expect(allowed.status).toBe(200);
      expect(await productRow(store.productId)).toEqual({
        avgRating: 5,
        reviewCount: 1,
      });
    });

    it('chi tiết đơn của tác giả: vẫn thấy bản của mình với isHidden true, canEdit false, kèm lý do của Admin; không biết Admin nào quyết định', async () => {
      const store = await newStore();
      const mine = await review(store, 1, { comment: 'Tệ' });
      await hide(admin, mine.reviewId, { reason: 'Ngôn từ xúc phạm' });

      const res = await mine.buyer.agent.get(`/api/v1/orders/${mine.orderId}`);

      expect(res.status).toBe(200);
      const item = (
        dataOf(res) as { items: { review: Record<string, unknown> | null }[] }
      ).items[0];
      expect(item.review).toMatchObject({
        id: mine.reviewId,
        isHidden: true,
        canEdit: false,
        hiddenReason: 'Ngôn từ xúc phạm',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/hiddenById|hiddenAt/);
      expect(JSON.stringify(res.body)).not.toContain(adminId);
    });

    it('chi tiết đơn khi chưa bị ẩn: isHidden false; sau khi mở lại: isHidden false và canEdit true', async () => {
      const store = await newStore();
      const mine = await review(store, 4);

      const before = await mine.buyer.agent.get(
        `/api/v1/orders/${mine.orderId}`,
      );
      await hide(admin, mine.reviewId);
      await unhide(admin, mine.reviewId);
      const after = await mine.buyer.agent.get(
        `/api/v1/orders/${mine.orderId}`,
      );

      for (const res of [before, after]) {
        const item = (
          dataOf(res) as { items: { review: Record<string, unknown> }[] }
        ).items[0];
        expect(item.review).toMatchObject({
          isHidden: false,
          canEdit: true,
          hiddenReason: null,
        });
      }
    });
  });

  describe('thông báo và nhật ký', () => {
    it('ẩn ⇒ đúng MỘT thông báo REVIEW_HIDDEN cho tác giả (id đơn + tên sản phẩm), không có lý do; chủ shop không nhận; mở lại không báo', async () => {
      const store = await newStore();
      const mine = await review(store, 1, { comment: 'Tệ' });
      const productName = (
        await prisma.product.findUniqueOrThrow({
          where: { id: store.productId },
          select: { name: true },
        })
      ).name;

      await hide(admin, mine.reviewId, { reason: 'LY-DO-RIENG-CUA-ADMIN' });

      const notes = await notificationsOf(mine.buyer.userId, 'REVIEW_HIDDEN');
      expect(notes).toHaveLength(1);
      expect(notes[0].data).toEqual({ orderId: mine.orderId, productName });
      expect(JSON.stringify(notes[0].data)).not.toContain('LY-DO-RIENG');
      expect(
        await notificationsOf(store.owner.userId, 'REVIEW_HIDDEN'),
      ).toHaveLength(0);

      await unhide(admin, mine.reviewId);
      expect(
        await notificationsOf(mine.buyer.userId, 'REVIEW_HIDDEN'),
      ).toHaveLength(1);
    });

    it('nhật ký quản trị: một dòng HIDE_REVIEW và một dòng UNHIDE_REVIEW, có lý do, người thực hiện và id sản phẩm', async () => {
      const store = await newStore();
      const mine = await review(store, 3);

      await hide(admin, mine.reviewId);
      await unhide(admin2, mine.reviewId, {
        reason: 'Đã xét lại, không vi phạm',
      });

      const hidden = await auditRows('HIDE_REVIEW', mine.reviewId);
      const restored = await auditRows('UNHIDE_REVIEW', mine.reviewId);
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toMatchObject({
        actorId: adminId,
        targetType: 'REVIEW',
        reason: REASON,
        meta: { productId: store.productId },
      });
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        reason: 'Đã xét lại, không vi phạm',
      });
    });

    it('cột ẩn của đánh giá ghi người ẩn và lý do (chỉ ở DB); mở lại xoá cả ba', async () => {
      const store = await newStore();
      const mine = await review(store, 3);

      await hide(admin, mine.reviewId);
      expect(await reviewRow(mine.reviewId)).toMatchObject({
        hiddenById: adminId,
        hiddenReason: REASON,
      });
      expect((await reviewRow(mine.reviewId)).hiddenAt).toBeInstanceOf(Date);

      await unhide(admin, mine.reviewId);
      expect(await reviewRow(mine.reviewId)).toMatchObject({
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
      });
    });
  });

  describe('trạng thái không hợp lệ và đua nhau', () => {
    it('ẩn đánh giá đã ẩn ⇒ 409 REVIEW_ALREADY_HIDDEN (không đổi lý do cũ); mở đánh giá đang hiển thị ⇒ 409 REVIEW_NOT_HIDDEN', async () => {
      const store = await newStore();
      const mine = await review(store, 3);

      const notHidden = await unhide(admin, mine.reviewId);
      await hide(admin, mine.reviewId, { reason: 'Lý do đầu tiên' });
      const again = await hide(admin2, mine.reviewId, {
        reason: 'Lý do thứ hai',
      });

      expect([notHidden.status, code(notHidden)]).toEqual([
        409,
        'REVIEW_NOT_HIDDEN',
      ]);
      expect([again.status, code(again)]).toEqual([
        409,
        'REVIEW_ALREADY_HIDDEN',
      ]);
      expect((await reviewRow(mine.reviewId)).hiddenReason).toBe(
        'Lý do đầu tiên',
      );
      expect(await auditRows('HIDE_REVIEW', mine.reviewId)).toHaveLength(1);
    });

    it('hai Admin ẩn CÙNG một đánh giá đồng thời: đúng một người thắng, điểm chỉ đổi một lần, đúng một nhật ký, tác giả đúng một thông báo', async () => {
      const store = await newStore();
      await review(store, 5);
      const target = await review(store, 1);

      const results = await Promise.all([
        hide(admin, target.reviewId),
        hide(admin2, target.reviewId),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await productRow(store.productId)).toEqual({
        avgRating: 5,
        reviewCount: 1,
      });
      expect(await auditRows('HIDE_REVIEW', target.reviewId)).toHaveLength(1);
      expect(
        await notificationsOf(target.buyer.userId, 'REVIEW_HIDDEN'),
      ).toHaveLength(1);
    });

    it('Admin ẩn và tác giả sửa CÙNG LÚC: kết quả nào cũng nhất quán — điểm sản phẩm luôn bằng tập đánh giá đang hiển thị', async () => {
      for (let round = 0; round < 4; round++) {
        const store = await newStore();
        await review(store, 5);
        const target = await review(store, 1);

        const [hidden, edited] = await Promise.all([
          hide(admin, target.reviewId),
          target.buyer.agent
            .patch(`/api/v1/reviews/${target.reviewId}`)
            .send({ rating: 4, comment: 'Đổi ý' }),
        ]);

        expect(hidden.status).toBe(200);
        expect([200, 409]).toContain(edited.status);
        if (edited.status === 409) expect(code(edited)).toBe('REVIEW_HIDDEN');
        expect((await reviewRow(target.reviewId)).hiddenAt).not.toBeNull();
        expect(await productRow(store.productId)).toEqual(
          await expectedAggregate(store.productId),
        );
      }
    });

    it('lỗi ghi nhật ký ⇒ ROLLBACK cả việc ẩn: đánh giá vẫn hiển thị, điểm không đổi, tác giả không bị báo', async () => {
      const store = await newStore();
      await review(store, 5);
      const target = await review(store, 1);
      jest
        .spyOn(app.get(AdminAuditService), 'record')
        .mockRejectedValueOnce(new Error('audit down'));

      const res = await hide(admin, target.reviewId);

      expect(res.status).toBe(500);
      expect((await reviewRow(target.reviewId)).hiddenAt).toBeNull();
      expect(await productRow(store.productId)).toEqual({
        avgRating: 3,
        reviewCount: 2,
      });
      expect(
        await notificationsOf(target.buyer.userId, 'REVIEW_HIDDEN'),
      ).toHaveLength(0);
    });
  });

  describe('log không bao giờ chứa lý do', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const store = await newStore();
      const ok = await review(store, 3);
      const leakyTarget = await review(store, 2);
      const captured: string[] = [];
      const restores: (() => void)[] = [];
      const capture = (chunk: unknown) => {
        captured.push(
          typeof chunk === 'string' ? chunk : JSON.stringify(chunk),
        );
      };
      for (const stream of [process.stdout, process.stderr]) {
        const spy = jest
          .spyOn(stream, 'write')
          .mockImplementation((chunk: unknown) => {
            capture(chunk);
            return true;
          });
        restores.push(() => spy.mockRestore());
      }
      for (const level of [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
        'fatal',
      ] as const) {
        const spy = jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            capture(args);
          });
        restores.push(() => spy.mockRestore());
      }
      const prismaService = app.get(PrismaService);

      let leaky: request.Response;
      try {
        await admin
          .post(hideUrl(ok.reviewId))
          .send({ reason: `${canary} lý do thường` });
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { hiddenReason: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await admin
          .post(hideUrl(leakyTarget.reviewId))
          .send({ reason: `${canary} lỗi Prisma` });
      } finally {
        jest.restoreAllMocks();
        restores.forEach((restore) => restore());
      }

      expect(leaky.status).toBe(500);
      expect(JSON.stringify(leaky.body)).not.toContain(canary);
      const logs = captured.join('\n');
      expect(logs).not.toContain(canary);
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: cả hai route khai báo đúng 200 và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin-reviews').setVersion('0').build(),
      );
      type Operations = Record<string, { responses: Record<string, unknown> }>;
      const hidePath = document.paths['/api/v1/admin/reviews/{id}/hide'] as
        Operations | undefined;
      const unhidePath = document.paths['/api/v1/admin/reviews/{id}/unhide'] as
        Operations | undefined;

      for (const [operation, observedSet] of [
        [hidePath?.post, observed.hide],
        [unhidePath?.post, observed.unhide],
      ] as const) {
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
        for (const status of [...observedSet].filter((s) => s !== 500)) {
          expect(documented).toEqual(expect.arrayContaining([status]));
        }
      }
    });
  });
});
