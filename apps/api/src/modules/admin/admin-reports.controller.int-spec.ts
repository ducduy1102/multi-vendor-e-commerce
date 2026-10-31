import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  adminOverviewSchema,
  adminReportDetailResponseSchema,
  adminReportListResponseSchema,
  createReportResponseSchema,
  REPORT_RESOLUTION_NOTE_MAX_LENGTH,
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

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho hàng đợi và xử lý báo cáo của Admin (Week11.md 5.4, D5). Chứng minh
// điều unit test với mock không chứng minh được: ma trận hành động × loại báo cáo, xử lý theo ĐỐI TƯỢNG (đóng hết báo cáo mở cùng
// đối tượng, hành động chạy MỘT lần, mỗi người báo một thông báo chung chung), hành động và đóng báo cáo cùng một giao dịch (lỗi nhật
// ký ⇒ rollback cả việc khoá shop), hai Admin đua nhau (khoá tư vấn theo đối tượng: không deadlock), phân quyền, và ghi chú không
// vào log. Chạy: `pnpm test:int`.
const TAG = 'it-admin-reports-';
const PASSWORD = 'password123';
const NUL = String.fromCharCode(0);
const fakeMail = createFakeMail();

describe('Hàng đợi và xử lý báo cáo của Admin (HTTP thật)', () => {
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

  // Status đã quan sát được trên từng route (để đối chiếu với Swagger).
  const observed = {
    list: new Set<number>(),
    detail: new Set<number>(),
    resolve: new Set<number>(),
  };

  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const dataOf = (res: { body: unknown }) =>
    (res.body as { data: unknown }).data;
  const NOTE = 'Bán hàng nhái thương hiệu, đã có nhiều báo cáo';

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
      select: { id: true },
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
      variantId: variant.id,
    };
  }

  async function newConversation(
    store: Store,
    buyer: Account,
  ): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        buyerId: buyer.userId,
        shopId: store.shopId,
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: buyer.userId,
        content: 'Xin chào shop',
      },
    });
    return conversation.id;
  }

  // Báo cáo THẬT qua POST /reports (đi cả quy trình tạo ảnh chụp). Trả id báo cáo.
  async function report(
    reporter: Account,
    targetType: string,
    targetId: string,
    reasonCode: string,
    note?: string,
  ): Promise<string> {
    const res = await reporter.agent
      .post('/api/v1/reports')
      .send({
        targetType,
        targetId,
        reasonCode,
        ...(note ? { note } : {}),
      })
      .expect(201);
    return createReportResponseSchema.parse(dataOf(res)).report.id;
  }

  const reportRow = (id: string) =>
    prisma.report.findUniqueOrThrow({ where: { id } });
  const resolveUrl = (id: string) => `/api/v1/admin/reports/${id}/resolve`;

  async function resolve(
    agent: Agent,
    id: string,
    body: Record<string, unknown>,
  ) {
    const res = await agent.post(resolveUrl(id)).send(body);
    observed.resolve.add(res.status);
    return res;
  }

  async function list(agent: Agent, query = '') {
    const res = await agent.get(`/api/v1/admin/reports${query}`);
    observed.list.add(res.status);
    return res;
  }

  // Tìm một báo cáo trong hàng đợi bằng cách lật qua các trang (hàng đợi chứa cả báo cáo của test khác nên không thể giả định nó nằm
  // ở trang đầu). Trả báo cáo và vị trí tuyệt đối của nó.
  async function findInQueue(query: string, id: string) {
    const pageSize = 50;
    for (let page = 1; page <= 500; page++) {
      const res = await list(admin, `${query}&limit=${pageSize}&page=${page}`);
      const parsed = adminReportListResponseSchema.parse(dataOf(res));
      const index = parsed.items.findIndex((item) => item.id === id);
      if (index >= 0) {
        return {
          item: parsed.items[index],
          position: (page - 1) * pageSize + index,
        };
      }
      if (page * pageSize >= parsed.total) break;
    }
    throw new Error(`report ${id} not found in queue ${query}`);
  }

  const notificationsOf = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type } });
  const auditRows = (action: string, targetId?: string) =>
    prisma.adminAuditLog.findMany({
      where: { action, ...(targetId ? { targetId } : {}) },
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
    // Thông báo gửi cả cho Admin THẬT của DB dev (không mang tiền tố test): dọn phần của lượt này.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền', () => {
    it('chưa đăng nhập 401 ở cả ba route', async () => {
      const id = randomUUID();

      const responses = await Promise.all([
        anonymous.get('/api/v1/admin/reports'),
        anonymous.get(`/api/v1/admin/reports/${id}`),
        anonymous.post(resolveUrl(id)).send({ action: 'DISMISS' }),
      ]);

      expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
    });

    it('người dùng thường và chủ shop 403 ở cả ba route, và báo cáo không bị đụng tới', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');

      for (const who of [reporter, store.owner]) {
        const responses = await Promise.all([
          who.agent.get('/api/v1/admin/reports'),
          who.agent.get(`/api/v1/admin/reports/${id}`),
          who.agent.post(resolveUrl(id)).send({ action: 'DISMISS' }),
        ]);
        expect(responses.map((r) => r.status)).toEqual([403, 403, 403]);
      }
      expect((await reportRow(id)).status).toBe('OPEN');
    });
  });

  describe('hàng đợi và chi tiết', () => {
    it('trả đúng hình dạng hợp đồng: người báo (tên + email), ảnh chụp theo loại, sameTargetOpenCount; Cache-Control no-store', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(
        reporter,
        'SHOP',
        store.shopId,
        'COUNTERFEIT',
        'Hàng nhái',
      );
      const reporterName = (
        await prisma.user.findUniqueOrThrow({
          where: { id: reporter.userId },
          select: { name: true },
        })
      ).name;

      const { item } = await findInQueue('?targetType=SHOP', id);
      const res = await list(admin, '?limit=1');

      expect(res.headers['cache-control']).toBe('no-store');
      expect(item).toMatchObject({
        targetType: 'SHOP',
        targetId: store.shopId,
        status: 'OPEN',
        reasonCode: 'COUNTERFEIT',
        note: 'Hàng nhái',
        reporter: { name: reporterName, email: reporter.email },
        resolution: null,
        sameTargetOpenCount: 0,
      });
      expect(Object.keys(item.snapshot).sort()).toEqual(['name', 'slug']);
      expect(JSON.stringify(item)).not.toContain(reporter.userId);
    });

    it('sameTargetOpenCount = số báo cáo mở KHÁC cùng đối tượng, không tính chính nó', async () => {
      const store = await newStore();
      const [a, b, c] = [
        await newAccount(),
        await newAccount(),
        await newAccount(),
      ];
      const ids = [
        await report(a, 'SHOP', store.shopId, 'SCAM'),
        await report(b, 'SHOP', store.shopId, 'SCAM'),
        await report(c, 'SHOP', store.shopId, 'SCAM'),
      ];

      for (const id of ids) {
        const { item } = await findInQueue('?targetType=SHOP', id);
        expect([id, item.sameTargetOpenCount]).toEqual([id, 2]);
      }
    });

    it('hàng chờ xếp cũ nhất trước; tab đã xử lý xếp xử lý gần nhất trước; lọc loại và phân trang đúng', async () => {
      const first = await newStore();
      const second = await newStore();
      const reporter = await newAccount();
      const older = await report(reporter, 'SHOP', first.shopId, 'SCAM');
      const newer = await report(reporter, 'SHOP', second.shopId, 'SCAM');
      await prisma.report.update({
        where: { id: older },
        data: { createdAt: new Date(Date.now() - 60_000) },
      });

      const olderOpen = await findInQueue('?targetType=SHOP', older);
      const newerOpen = await findInQueue('?targetType=SHOP', newer);
      expect(olderOpen.position).toBeLessThan(newerOpen.position);

      await resolve(admin, older, { action: 'DISMISS' });
      await resolve(admin, newer, { action: 'DISMISS' });
      const olderClosed = await findInQueue(
        '?status=CLOSED&targetType=SHOP',
        older,
      );
      const newerClosed = await findInQueue(
        '?status=CLOSED&targetType=SHOP',
        newer,
      );
      expect(newerClosed.position).toBeLessThan(olderClosed.position);
      expect(newerClosed.item.status).toBe('DISMISSED');

      const page = adminReportListResponseSchema.parse(
        dataOf(
          await list(admin, '?status=CLOSED&targetType=SHOP&limit=1&page=2'),
        ),
      );
      expect(page.items).toHaveLength(1);
      expect(page.page).toBe(2);
      expect(page.limit).toBe(1);
      expect(page.total).toBeGreaterThanOrEqual(2);
    });

    it.each([
      ['status lạ', '?status=ALL'],
      ['loại lạ', '?targetType=USER'],
      ['limit quá 50', '?limit=51'],
      ['page bằng 0', '?page=0'],
      ['page vượt trần', '?page=1e21'],
    ])('query không hợp lệ (%s) ⇒ 400', async (_name, query) => {
      const res = await list(admin, query);

      expect(res.status).toBe(400);
    });

    it('chi tiết: cùng hình dạng một dòng; id không có và id sai dạng ra cùng một 404 REPORT_NOT_FOUND', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');

      const found = await admin.get(`/api/v1/admin/reports/${id}`);
      const missing = await admin.get(`/api/v1/admin/reports/${randomUUID()}`);
      const malformed = await admin.get('/api/v1/admin/reports/not-a-uuid');
      const nul = await admin.get(`/api/v1/admin/reports/abc%00def`);
      for (const res of [found, missing, malformed, nul]) {
        observed.detail.add(res.status);
      }

      expect(found.status).toBe(200);
      expect(
        adminReportDetailResponseSchema.parse(dataOf(found)).report.id,
      ).toBe(id);
      expect([missing.status, code(missing)]).toEqual([
        404,
        'REPORT_NOT_FOUND',
      ]);
      expect(malformed.body).toEqual(missing.body);
      expect(nul.body).toEqual(missing.body);
    });

    it('ảnh chụp hội thoại KHÔNG có nội dung tin nhắn, kể cả trong hàng đợi của Admin', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer);
      await prisma.message.create({
        data: {
          conversationId,
          senderId: buyer.userId,
          content: 'CANARY-NOI-DUNG-TIN-NHAN',
        },
      });
      const id = await report(
        buyer,
        'CONVERSATION',
        conversationId,
        'HARASSMENT',
      );

      const { item } = await findInQueue('?targetType=CONVERSATION', id);
      const detail = await admin.get(`/api/v1/admin/reports/${id}`);

      expect(item.targetType).toBe('CONVERSATION');
      expect(JSON.stringify(item)).not.toContain('CANARY-NOI-DUNG');
      expect(JSON.stringify(detail.body)).not.toContain('CANARY-NOI-DUNG');
    });
  });

  describe('số báo cáo mở ở GET /admin/overview (Week11.md 5.6)', () => {
    const openReports = async () =>
      adminOverviewSchema.parse(
        dataOf(await admin.get('/api/v1/admin/overview').expect(200)),
      ).openReports;
    const openTabTotal = async () =>
      (dataOf(await list(admin, '?status=OPEN&limit=1')) as { total: number })
        .total;

    it('luôn BẰNG total của tab "Chờ xử lý"; tăng theo từng báo cáo mới và giảm theo số báo cáo bị ĐÓNG khi xử lý một báo cáo (đóng cả báo cáo trùng đối tượng)', async () => {
      const store = await newStore();
      const first = await newAccount();
      const second = await newAccount();
      const before = await openReports();
      expect(before).toBe(await openTabTotal());

      const id = await report(first, 'SHOP', store.shopId, 'SCAM');
      await report(second, 'SHOP', store.shopId, 'COUNTERFEIT');
      expect(await openReports()).toBe(before + 2);
      expect(await openReports()).toBe(await openTabTotal());

      const res = await resolve(admin, id, { action: 'DISMISS' });

      expect(res.status).toBe(200);
      // Một hành động đóng CẢ hai báo cáo cùng đối tượng.
      expect(await openReports()).toBe(before);
      expect(await openReports()).toBe(await openTabTotal());
    });

    it('báo cáo đã xử lý không bao giờ được tính vào số việc chờ', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const before = await openReports();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');
      await resolve(admin, id, { action: 'DISMISS' });

      expect(await openReports()).toBe(before);
    });
  });

  describe('xử lý theo đối tượng', () => {
    it('DISMISS: đóng MỌI báo cáo mở của đối tượng là DISMISSED, ghi chú tuỳ chọn, mỗi người báo một thông báo chung chung', async () => {
      const store = await newStore();
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(a, 'SHOP', store.shopId, 'SCAM');
      const idB = await report(b, 'SHOP', store.shopId, 'COUNTERFEIT');

      const res = await resolve(admin, idA, { action: 'DISMISS' });

      expect(res.status).toBe(200);
      const body = adminReportDetailResponseSchema.parse(dataOf(res));
      expect(body.report).toMatchObject({
        id: idA,
        status: 'DISMISSED',
        sameTargetOpenCount: 0,
        resolution: { action: 'DISMISS', note: null },
      });
      for (const id of [idA, idB]) {
        expect(await reportRow(id)).toMatchObject({
          status: 'DISMISSED',
          resolvedById: adminId,
          resolutionAction: 'DISMISS',
          resolutionNote: null,
        });
      }
      for (const [who, id] of [
        [a, idA],
        [b, idB],
      ] as const) {
        const notes = await notificationsOf(who.userId, 'REPORT_RESOLVED');
        expect(notes).toHaveLength(1);
        expect(notes[0].data).toEqual({
          reportId: id,
          targetType: 'SHOP',
          outcome: 'DISMISSED',
        });
      }
      // Shop không bị đụng tới và chủ shop không nhận gì.
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
          .status,
      ).toBe('APPROVED');
      expect(
        await prisma.notification.count({
          where: { userId: store.owner.userId, type: 'REPORT_RESOLVED' },
        }),
      ).toBe(0);
    });

    it('DISMISS cho cả bốn loại đối tượng', async () => {
      const store = await newStore();
      const author = await newAccount();
      const reporter = await newAccount();
      const conversationId = await newConversation(store, reporter);
      const { orderId } = await createOrderWithItem(prisma, {
        userId: author.userId,
        shopId: store.shopId,
        variantId: store.variantId,
      });
      const review = await prisma.review.create({
        data: {
          userId: author.userId,
          productId: store.productId,
          orderId,
          rating: 1,
          comment: 'Tệ',
        },
        select: { id: true },
      });
      const ids = [
        await report(reporter, 'SHOP', store.shopId, 'SCAM'),
        await report(reporter, 'PRODUCT', store.productId, 'COUNTERFEIT'),
        await report(reporter, 'REVIEW', review.id, 'SPAM'),
        await report(reporter, 'CONVERSATION', conversationId, 'SPAM'),
      ];

      for (const id of ids) {
        const res = await resolve(admin, id, { action: 'DISMISS' });
        expect([id, res.status]).toEqual([id, 200]);
        expect((await reportRow(id)).status).toBe('DISMISSED');
      }
    });

    // Đánh giá dựng thẳng ở DB kèm tính lại điểm (chỉ dùng cho dữ liệu dựng sẵn; luồng ẩn thật chạy qua API).
    async function seedReview(store: Store, rating: number) {
      const author = await newAccount();
      const { orderId } = await createOrderWithItem(prisma, {
        userId: author.userId,
        shopId: store.shopId,
        variantId: store.variantId,
      });
      const created = await prisma.review.create({
        data: {
          userId: author.userId,
          productId: store.productId,
          orderId,
          rating,
          comment: 'Nội dung đánh giá',
        },
        select: { id: true },
      });
      await prisma.$executeRaw`
        UPDATE products p SET
          avg_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2)::float8 FROM reviews WHERE product_id = p.id AND hidden_at IS NULL), 0),
          review_count = (SELECT COUNT(*)::int FROM reviews WHERE product_id = p.id AND hidden_at IS NULL)
        WHERE p.id = ${store.productId}`;
      return { author, orderId, reviewId: created.id };
    }
    const ratingOf = (productId: string) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { avgRating: true, reviewCount: true },
      });

    it('HIDE_REVIEW: ẩn đánh giá bị báo, tính lại điểm, đóng hết báo cáo trùng, báo tác giả và mỗi người báo, hai dòng nhật ký (Week11.md 5.5)', async () => {
      const store = await newStore();
      await seedReview(store, 5);
      const bad = await seedReview(store, 1);
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(
        a,
        'REVIEW',
        bad.reviewId,
        'OFFENSIVE_LANGUAGE',
        'Xúc phạm',
      );
      const idB = await report(b, 'REVIEW', bad.reviewId, 'SPAM');
      expect(await ratingOf(store.productId)).toEqual({
        avgRating: 3,
        reviewCount: 2,
      });

      const res = await resolve(admin, idA, {
        action: 'HIDE_REVIEW',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      const hidden = await prisma.review.findUniqueOrThrow({
        where: { id: bad.reviewId },
      });
      expect(hidden).toMatchObject({ hiddenById: adminId, hiddenReason: NOTE });
      expect(hidden.hiddenAt).toBeInstanceOf(Date);
      expect(await ratingOf(store.productId)).toEqual({
        avgRating: 5,
        reviewCount: 1,
      });
      for (const id of [idA, idB]) {
        expect(await reportRow(id)).toMatchObject({
          status: 'RESOLVED',
          resolutionAction: 'HIDE_REVIEW',
        });
      }
      // Tác giả đúng MỘT thông báo (không lý do), mỗi người báo đúng một thông báo chung chung.
      const authorNotes = await notificationsOf(
        bad.author.userId,
        'REVIEW_HIDDEN',
      );
      expect(authorNotes).toHaveLength(1);
      expect(authorNotes[0].data).toMatchObject({ orderId: bad.orderId });
      expect(JSON.stringify(authorNotes[0].data)).not.toContain('nhái');
      for (const who of [a, b]) {
        expect(
          await notificationsOf(who.userId, 'REPORT_RESOLVED'),
        ).toHaveLength(1);
      }
      // Hai dòng nhật ký: ẩn đánh giá + xử lý báo cáo.
      expect(await auditRows('HIDE_REVIEW', bad.reviewId)).toHaveLength(1);
      expect(await auditRows('RESOLVE_REPORT', idA)).toHaveLength(1);
    });

    it('HIDE_REVIEW khi đánh giá đã bị ẩn từ trước: không ẩn lại, tác giả không bị báo lần nữa, báo cáo vẫn đóng, nhật ký ghi alreadyApplied', async () => {
      const store = await newStore();
      const bad = await seedReview(store, 1);
      const reporter = await newAccount();
      const id = await report(reporter, 'REVIEW', bad.reviewId, 'SPAM');
      const first = await admin2
        .post(`/api/v1/admin/reviews/${bad.reviewId}/hide`)
        .send({ reason: 'Ẩn từ trước' });
      expect(first.status).toBe(200);
      const before = await notificationsOf(bad.author.userId, 'REVIEW_HIDDEN');

      const res = await resolve(admin, id, {
        action: 'HIDE_REVIEW',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect((await reportRow(id)).status).toBe('RESOLVED');
      expect(await auditRows('HIDE_REVIEW', bad.reviewId)).toHaveLength(1);
      expect(
        await notificationsOf(bad.author.userId, 'REVIEW_HIDDEN'),
      ).toHaveLength(before.length);
      const [row] = await auditRows('RESOLVE_REPORT', id);
      expect(row.meta).toMatchObject({ alreadyApplied: true });
    });

    it('HIDE_REVIEW: lỗi nhật ký ⇒ ROLLBACK cả việc ẩn lẫn đóng báo cáo (đánh giá vẫn hiển thị, điểm không đổi)', async () => {
      const store = await newStore();
      await seedReview(store, 5);
      const bad = await seedReview(store, 1);
      const reporter = await newAccount();
      const id = await report(reporter, 'REVIEW', bad.reviewId, 'SPAM');
      jest
        .spyOn(app.get(AdminAuditService), 'record')
        .mockRejectedValueOnce(new Error('audit down'));

      const res = await resolve(admin, id, {
        action: 'HIDE_REVIEW',
        note: NOTE,
      });

      expect(res.status).toBe(500);
      expect((await reportRow(id)).status).toBe('OPEN');
      expect(
        (await prisma.review.findUniqueOrThrow({ where: { id: bad.reviewId } }))
          .hiddenAt,
      ).toBeNull();
      expect(await ratingOf(store.productId)).toEqual({
        avgRating: 3,
        reviewCount: 2,
      });
    });

    it('TAKE_DOWN_PRODUCT: gỡ sản phẩm bị báo với lý do là ghi chú, đóng hết báo cáo trùng, báo chủ shop (kèm lý do) và mỗi người báo, hai dòng nhật ký (Week11.md 5.7)', async () => {
      const store = await newStore();
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(
        a,
        'PRODUCT',
        store.productId,
        'PROHIBITED_ITEM',
        'Dao bấm',
      );
      const idB = await report(b, 'PRODUCT', store.productId, 'COUNTERFEIT');

      const res = await resolve(admin, idA, {
        action: 'TAKE_DOWN_PRODUCT',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect(
        await prisma.product.findUniqueOrThrow({
          where: { id: store.productId },
        }),
      ).toMatchObject({
        status: 'TAKEN_DOWN',
        takenDownById: adminId,
        takenDownReason: NOTE,
      });
      for (const id of [idA, idB]) {
        expect(await reportRow(id)).toMatchObject({
          status: 'RESOLVED',
          resolutionAction: 'TAKE_DOWN_PRODUCT',
          resolutionNote: NOTE,
        });
      }
      // Chủ shop đúng MỘT thông báo (kèm lý do); mỗi người báo đúng một thông báo chung chung.
      const ownerNotes = await notificationsOf(
        store.owner.userId,
        'PRODUCT_TAKEN_DOWN',
      );
      expect(ownerNotes).toHaveLength(1);
      expect(ownerNotes[0].data).toMatchObject({
        productId: store.productId,
        reason: NOTE,
      });
      for (const who of [a, b]) {
        expect(
          await notificationsOf(who.userId, 'REPORT_RESOLVED'),
        ).toHaveLength(1);
        // Người báo KHÔNG nhận thông báo "sản phẩm bị gỡ" — đó là việc của chủ shop.
        expect(
          await notificationsOf(who.userId, 'PRODUCT_TAKEN_DOWN'),
        ).toHaveLength(0);
      }
      // Hai dòng nhật ký: gỡ sản phẩm + xử lý báo cáo.
      expect(
        await auditRows('TAKE_DOWN_PRODUCT', store.productId),
      ).toHaveLength(1);
      expect(await auditRows('RESOLVE_REPORT', idA)).toHaveLength(1);
    });

    it('TAKE_DOWN_PRODUCT khi sản phẩm đã bị gỡ từ trước: không gỡ lại, chủ shop không bị báo lần nữa, báo cáo vẫn đóng, nhật ký ghi alreadyApplied', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(
        reporter,
        'PRODUCT',
        store.productId,
        'MISLEADING_INFO',
      );
      const first = await admin2
        .post(`/api/v1/admin/products/${store.productId}/take-down`)
        .send({ reason: 'Gỡ từ trước' });
      expect(first.status).toBe(200);

      const res = await resolve(admin, id, {
        action: 'TAKE_DOWN_PRODUCT',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect((await reportRow(id)).status).toBe('RESOLVED');
      expect(
        await auditRows('TAKE_DOWN_PRODUCT', store.productId),
      ).toHaveLength(1);
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(1);
      // Lý do trên sản phẩm vẫn là của lần gỡ ĐẦU TIÊN, không bị ghi đè bởi ghi chú xử lý báo cáo.
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: store.productId },
          })
        ).takenDownReason,
      ).toBe('Gỡ từ trước');
      const [row] = await auditRows('RESOLVE_REPORT', id);
      expect(row.meta).toMatchObject({ alreadyApplied: true });
    });

    it('TAKE_DOWN_PRODUCT: lỗi nhật ký ⇒ ROLLBACK cả việc gỡ lẫn đóng báo cáo (sản phẩm vẫn đang bán, không báo chủ shop)', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(
        reporter,
        'PRODUCT',
        store.productId,
        'MISLEADING_INFO',
      );
      jest
        .spyOn(app.get(AdminAuditService), 'record')
        .mockRejectedValueOnce(new Error('audit down'));

      const res = await resolve(admin, id, {
        action: 'TAKE_DOWN_PRODUCT',
        note: NOTE,
      });

      expect(res.status).toBe(500);
      expect((await reportRow(id)).status).toBe('OPEN');
      expect(
        await prisma.product.findUniqueOrThrow({
          where: { id: store.productId },
        }),
      ).toMatchObject({ status: 'PUBLISHED', takenDownReason: null });
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(0);
    });

    it('DISMISS báo cáo sản phẩm: sản phẩm vẫn đang bán, chủ shop không nhận gì', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(
        reporter,
        'PRODUCT',
        store.productId,
        'MISLEADING_INFO',
      );

      const res = await resolve(admin, id, { action: 'DISMISS' });

      expect(res.status).toBe(200);
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: store.productId },
          })
        ).status,
      ).toBe('PUBLISHED');
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(0);
    });

    it('SUSPEND_SHOP: khoá shop với lý do là ghi chú, đóng hết báo cáo trùng, MỘT dòng nhật ký, chủ shop nhận thông báo/email như luồng khoá thường', async () => {
      const store = await newStore();
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(a, 'SHOP', store.shopId, 'COUNTERFEIT', 'Nhái');
      const idB = await report(b, 'SHOP', store.shopId, 'SCAM');
      fakeMail.reset();

      const res = await resolve(admin, idA, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect(
        adminReportDetailResponseSchema.parse(dataOf(res)).report.resolution,
      ).toMatchObject({ action: 'SUSPEND_SHOP', note: NOTE });
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: store.shopId },
      });
      expect(shop).toMatchObject({ status: 'SUSPENDED', statusReason: NOTE });
      const history = await prisma.shopStatusHistory.findMany({
        where: { shopId: store.shopId, toStatus: 'SUSPENDED' },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        actorType: 'ADMIN',
        actorId: adminId,
      });
      for (const id of [idA, idB]) {
        expect(await reportRow(id)).toMatchObject({
          status: 'RESOLVED',
          resolutionAction: 'SUSPEND_SHOP',
          resolutionNote: NOTE,
        });
      }
      // Chủ shop nhận đúng thông báo khoá shop (không phải thông báo báo cáo) và email, không lộ người báo.
      expect(
        await notificationsOf(store.owner.userId, 'SHOP_STATUS_CHANGED'),
      ).toHaveLength(1);
      expect(
        await prisma.notification.count({
          where: {
            userId: store.owner.userId,
            type: { startsWith: 'REPORT_' },
          },
        }),
      ).toBe(0);
      const ownerMail = fakeMail.sent.filter((m) => m.to === store.owner.email);
      expect(ownerMail).toHaveLength(1);
      for (const reporter of [a, b]) {
        expect(ownerMail[0].html).not.toContain(reporter.email);
      }
      // Nhật ký: đúng MỘT dòng RESOLVE_REPORT, lên báo cáo vừa xử lý.
      const rows = await auditRows('RESOLVE_REPORT', idA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: adminId,
        targetType: 'REPORT',
        reason: NOTE,
        meta: {
          action: 'SUSPEND_SHOP',
          targetType: 'SHOP',
          targetId: store.shopId,
          closedReports: 2,
          alreadyApplied: false,
        },
      });
      expect(await auditRows('RESOLVE_REPORT', idB)).toHaveLength(0);
      // Mỗi người báo nhận kết quả CHUNG CHUNG, không lộ hành động.
      for (const who of [a, b]) {
        const notes = await notificationsOf(who.userId, 'REPORT_RESOLVED');
        expect(notes).toHaveLength(1);
        expect((notes[0].data as { outcome: string }).outcome).toBe('RESOLVED');
        expect(JSON.stringify(notes[0].data)).not.toMatch(/SUSPEND|NOTE|nhái/i);
      }
    });

    it('SUSPEND_SHOP khi shop đã bị khoá từ trước: báo cáo vẫn đóng là đã xử lý, KHÔNG khoá lại, nhật ký ghi alreadyApplied', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');
      const first = await admin2
        .patch(`/api/v1/admin/shops/${store.shopId}/status`)
        .send({ status: 'SUSPENDED', reason: 'Khoá từ báo cáo khác' });
      expect(first.status).toBe(200);

      const res = await resolve(admin, id, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect((await reportRow(id)).status).toBe('RESOLVED');
      const history = await prisma.shopStatusHistory.findMany({
        where: { shopId: store.shopId, toStatus: 'SUSPENDED' },
      });
      expect(history).toHaveLength(1);
      const [row] = await auditRows('RESOLVE_REPORT', id);
      expect(row.meta).toMatchObject({ alreadyApplied: true });
    });

    it.each(['BUYER', 'SHOP'] as const)(
      'SUSPEND_REPORTED_USER, người báo là %s ⇒ tạm khoá tài khoản của BÊN CÒN LẠI, kéo theo shop, thu hồi phiên, hai dòng nhật ký',
      async (reporterRole) => {
        const store = await newStore();
        const buyer = await newAccount();
        const conversationId = await newConversation(store, buyer);
        const reporter = reporterRole === 'BUYER' ? buyer : store.owner;
        const reported = reporterRole === 'BUYER' ? store.owner : buyer;
        const id = await report(
          reporter,
          'CONVERSATION',
          conversationId,
          'HARASSMENT',
        );
        await prisma.user.update({
          where: { id: reported.userId },
          data: { refreshTokenHash: 'to-be-revoked' },
        });
        fakeMail.reset();

        const res = await resolve(admin, id, {
          action: 'SUSPEND_REPORTED_USER',
          note: NOTE,
        });

        expect(res.status).toBe(200);
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: reported.userId },
        });
        expect(user).toMatchObject({
          accountStatus: 'SUSPENDED',
          statusReason: NOTE,
          refreshTokenHash: null,
        });
        const other = await prisma.user.findUniqueOrThrow({
          where: { id: reporter.userId },
        });
        expect(other.accountStatus).toBe('ACTIVE');
        expect(
          (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
            .status,
        ).toBe(reporterRole === 'BUYER' ? 'SUSPENDED' : 'APPROVED');
        expect(await auditRows('SUSPEND_USER', reported.userId)).toHaveLength(
          1,
        );
        expect(await auditRows('RESOLVE_REPORT', id)).toHaveLength(1);
        expect(
          fakeMail.sent.filter((m) => m.to === reported.email),
        ).toHaveLength(1);
        expect(fakeMail.sent.some((m) => m.to === reporter.email)).toBe(false);
      },
    );

    it('SUSPEND_REPORTED_USER khi bên bị báo là Admin ⇒ 409 CANNOT_MODIFY_ADMIN và báo cáo VẪN MỞ (rollback)', async () => {
      const store = await newStore();
      await prisma.user.update({
        where: { id: store.owner.userId },
        data: { role: 'ADMIN' },
      });
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer);
      const id = await report(buyer, 'CONVERSATION', conversationId, 'SCAM');

      const res = await resolve(admin, id, {
        action: 'SUSPEND_REPORTED_USER',
        note: NOTE,
      });

      expect([res.status, code(res)]).toEqual([409, 'CANNOT_MODIFY_ADMIN']);
      expect((await reportRow(id)).status).toBe('OPEN');
    });

    it('SUSPEND_REPORTED_USER khi tài khoản bị báo đã bị khoá: không khoá lại, báo cáo vẫn đóng', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer);
      const id = await report(buyer, 'CONVERSATION', conversationId, 'SCAM');
      await prisma.user.update({
        where: { id: store.owner.userId },
        data: { accountStatus: 'BANNED' },
      });

      const res = await resolve(admin, id, {
        action: 'SUSPEND_REPORTED_USER',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect((await reportRow(id)).status).toBe('RESOLVED');
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: store.owner.userId },
          })
        ).accountStatus,
      ).toBe('BANNED');
      expect(await auditRows('SUSPEND_USER', store.owner.userId)).toHaveLength(
        0,
      );
    });
  });

  describe('hành động không hợp lệ ⇒ báo cáo giữ nguyên', () => {
    it.each([
      ['hành động của loại khác (HIDE_REVIEW cho báo cáo shop)', 'HIDE_REVIEW'],
      ['TAKE_DOWN_PRODUCT cho báo cáo shop', 'TAKE_DOWN_PRODUCT'],
      ['BLOCK_BUYER cho báo cáo shop', 'BLOCK_BUYER'],
      ['SUSPEND_REPORTED_USER cho báo cáo shop', 'SUSPEND_REPORTED_USER'],
    ])('%s ⇒ 409 REPORT_ACTION_NOT_ALLOWED', async (_name, action) => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');

      const res = await resolve(admin, id, { action, note: NOTE });

      expect([res.status, code(res)]).toEqual([
        409,
        'REPORT_ACTION_NOT_ALLOWED',
      ]);
      expect((await reportRow(id)).status).toBe('OPEN');
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
          .status,
      ).toBe('APPROVED');
    });

    it('BLOCK_BUYER khi bên bị báo là chủ shop (người mua báo) ⇒ 409; hành động chưa có bộ xử lý ⇒ 409 và không đóng gì', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer);
      const idConversation = await report(
        buyer,
        'CONVERSATION',
        conversationId,
        'SCAM',
      );

      const block = await resolve(admin, idConversation, {
        action: 'BLOCK_BUYER',
        note: NOTE,
      });

      expect([block.status, code(block)]).toEqual([
        409,
        'REPORT_ACTION_NOT_ALLOWED',
      ]);
      expect((await reportRow(idConversation)).status).toBe('OPEN');
      expect(await auditRows('RESOLVE_REPORT', idConversation)).toHaveLength(0);
    });

    it('hành động của loại khác trên báo cáo SẢN PHẨM (HIDE_REVIEW, SUSPEND_SHOP) ⇒ 409 và sản phẩm không bị gỡ', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(
        reporter,
        'PRODUCT',
        store.productId,
        'MISLEADING_INFO',
      );

      const hide = await resolve(admin, id, {
        action: 'HIDE_REVIEW',
        note: NOTE,
      });
      const suspend = await resolve(admin, id, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect([hide.status, code(hide)]).toEqual([
        409,
        'REPORT_ACTION_NOT_ALLOWED',
      ]);
      expect([suspend.status, code(suspend)]).toEqual([
        409,
        'REPORT_ACTION_NOT_ALLOWED',
      ]);
      expect((await reportRow(id)).status).toBe('OPEN');
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: store.productId },
          })
        ).status,
      ).toBe('PUBLISHED');
    });

    it.each([
      ['thiếu hành động', {}],
      ['hành động lạ', { action: 'DELETE_EVERYTHING', note: 'x' }],
      ['hành động xử lý không có ghi chú', { action: 'SUSPEND_SHOP' }],
      ['ghi chú toàn khoảng trắng', { action: 'SUSPEND_SHOP', note: '   ' }],
      [
        'ghi chú quá 500 ký tự',
        {
          action: 'SUSPEND_SHOP',
          note: 'a'.repeat(REPORT_RESOLUTION_NOTE_MAX_LENGTH + 1),
        },
      ],
      ['ghi chú có ký tự điều khiển', { action: 'DISMISS', note: `a${NUL}b` }],
    ])(
      'body không hợp lệ (%s) ⇒ 400 và báo cáo giữ nguyên',
      async (_name, body) => {
        const store = await newStore();
        const reporter = await newAccount();
        const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');

        const res = await resolve(admin, id, body);

        expect(res.status).toBe(400);
        expect((await reportRow(id)).status).toBe('OPEN');
      },
    );

    it('id không tồn tại hoặc sai dạng ⇒ 404 REPORT_NOT_FOUND, cùng body', async () => {
      const missing = await resolve(admin, randomUUID(), { action: 'DISMISS' });
      const malformed = await resolve(admin, 'not-a-uuid', {
        action: 'DISMISS',
      });

      expect([missing.status, code(missing)]).toEqual([
        404,
        'REPORT_NOT_FOUND',
      ]);
      expect(malformed.body).toEqual(missing.body);
    });

    it('báo cáo đã đóng ⇒ 409 REPORT_ALREADY_CLOSED — kể cả báo cáo TRÙNG vừa bị đóng theo báo cáo khác', async () => {
      const store = await newStore();
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(a, 'SHOP', store.shopId, 'SCAM');
      const idB = await report(b, 'SHOP', store.shopId, 'SCAM');
      await resolve(admin, idA, { action: 'DISMISS' });

      const again = await resolve(admin, idA, { action: 'DISMISS' });
      const sibling = await resolve(admin2, idB, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect([again.status, code(again)]).toEqual([
        409,
        'REPORT_ALREADY_CLOSED',
      ]);
      expect([sibling.status, code(sibling)]).toEqual([
        409,
        'REPORT_ALREADY_CLOSED',
      ]);
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
          .status,
      ).toBe('APPROVED');
    });
  });

  describe('đua nhau và toàn vẹn giao dịch', () => {
    it('hai Admin xử lý CÙNG một báo cáo đồng thời: đúng một người thắng, shop bị khoá đúng một lần, đúng một dòng nhật ký, mỗi người báo đúng một thông báo', async () => {
      const store = await newStore();
      const a = await newAccount();
      const b = await newAccount();
      const idA = await report(a, 'SHOP', store.shopId, 'SCAM');
      await report(b, 'SHOP', store.shopId, 'SCAM');

      const results = await Promise.all([
        resolve(admin, idA, { action: 'SUSPEND_SHOP', note: NOTE }),
        resolve(admin2, idA, { action: 'SUSPEND_SHOP', note: NOTE }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(code(loser as request.Response)).toBe('REPORT_ALREADY_CLOSED');
      expect(
        await prisma.shopStatusHistory.count({
          where: { shopId: store.shopId, toStatus: 'SUSPENDED' },
        }),
      ).toBe(1);
      expect(await auditRows('RESOLVE_REPORT', idA)).toHaveLength(1);
      for (const who of [a, b]) {
        expect(
          await notificationsOf(who.userId, 'REPORT_RESOLVED'),
        ).toHaveLength(1);
      }
    });

    it('nhiều Admin xử lý các báo cáo KHÁC NHAU của cùng một đối tượng đồng thời: không deadlock (không có 500), đúng một thắng, phần còn lại 409', async () => {
      const store = await newStore();
      const reporters = [
        await newAccount(),
        await newAccount(),
        await newAccount(),
      ];
      const ids: string[] = [];
      for (const reporter of reporters) {
        ids.push(await report(reporter, 'SHOP', store.shopId, 'SCAM'));
      }

      const results = await Promise.all([
        resolve(admin, ids[0], { action: 'SUSPEND_SHOP', note: NOTE }),
        resolve(admin2, ids[1], { action: 'DISMISS' }),
        resolve(admin, ids[2], { action: 'SUSPEND_SHOP', note: NOTE }),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(code(res)).toBe('REPORT_ALREADY_CLOSED');
      }
      const rows = await prisma.report.findMany({
        where: { targetId: store.shopId },
      });
      expect(new Set(rows.map((r) => r.status)).size).toBe(1);
      expect(new Set(rows.map((r) => r.resolutionAction)).size).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: 'RESOLVE_REPORT', targetId: { in: ids } },
        }),
      ).toBe(1);
    });

    it('lỗi ghi nhật ký ⇒ ROLLBACK cả việc khoá shop và đóng báo cáo (không có hành động nào mà thiếu dấu vết)', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');
      jest
        .spyOn(app.get(AdminAuditService), 'record')
        .mockRejectedValueOnce(new Error('audit down'));

      const res = await resolve(admin, id, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect(res.status).toBe(500);
      expect((await reportRow(id)).status).toBe('OPEN');
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
          .status,
      ).toBe('APPROVED');
      expect(
        await prisma.shopStatusHistory.count({
          where: { shopId: store.shopId, toStatus: 'SUSPENDED' },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { userId: reporter.userId, type: 'REPORT_RESOLVED' },
        }),
      ).toBe(0);
    });

    it('email lỗi sau commit KHÔNG làm hỏng việc xử lý: báo cáo đã đóng, shop đã bị khoá', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const id = await report(reporter, 'SHOP', store.shopId, 'SCAM');
      fakeMail.failWith();

      const res = await resolve(admin, id, {
        action: 'SUSPEND_SHOP',
        note: NOTE,
      });

      expect(res.status).toBe(200);
      expect((await reportRow(id)).status).toBe('RESOLVED');
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: store.shopId } }))
          .status,
      ).toBe('SUSPENDED');
    });
  });

  describe('log không bao giờ chứa ghi chú', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const ok = await newStore();
      const leakyStore = await newStore();
      const downStore = await newStore();
      const reporter = await newAccount();
      const okId = await report(reporter, 'SHOP', ok.shopId, 'SCAM');
      const leakyId = await report(reporter, 'SHOP', leakyStore.shopId, 'SCAM');
      const downId = await report(reporter, 'SHOP', downStore.shopId, 'SCAM');
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
      let down: request.Response;
      try {
        // 1. luồng thường
        await admin
          .post(resolveUrl(okId))
          .send({ action: 'SUSPEND_SHOP', note: `${canary} ghi chú thường` });
        // 2. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả ghi chú)
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { resolutionNote: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await admin
          .post(resolveUrl(leakyId))
          .send({ action: 'SUSPEND_SHOP', note: `${canary} lỗi Prisma` });
        // 3. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(new Error('db down'));
        down = await admin
          .post(resolveUrl(downId))
          .send({ action: 'SUSPEND_SHOP', note: `${canary} DB sập` });
      } finally {
        jest.restoreAllMocks();
        restores.forEach((restore) => restore());
      }

      expect(leaky.status).toBe(500);
      expect(down.status).toBe(500);
      expect(JSON.stringify([leaky.body, down.body])).not.toContain(canary);

      const logs = captured.join('\n');
      // Không phải test rỗng: các lỗi cố ý ở trên PHẢI đã để lại dấu vết trong log...
      expect(logs).toContain('db down');
      expect(logs).toContain('details omitted');
      // ...nhưng không có ghi chú của Admin.
      expect(logs).not.toContain(canary);
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: mỗi route khai báo đúng một status thành công (200) và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin-reports').setVersion('0').build(),
      );
      type Operations = Record<string, { responses: Record<string, unknown> }>;
      const listPath = document.paths['/api/v1/admin/reports'] as
        Operations | undefined;
      const detailPath = document.paths['/api/v1/admin/reports/{id}'] as
        Operations | undefined;
      const resolvePath = document.paths[
        '/api/v1/admin/reports/{id}/resolve'
      ] as Operations | undefined;

      for (const [operation, observedSet] of [
        [listPath?.get, observed.list],
        [detailPath?.get, observed.detail],
        [resolvePath?.post, observed.resolve],
      ] as const) {
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
        // 500 chỉ do test cố ý phá lúc ghi, không phải hành vi cần tài liệu.
        for (const status of [...observedSet].filter((s) => s !== 500)) {
          expect(documented).toEqual(expect.arrayContaining([status]));
        }
      }
      expect([...observed.detail].sort()).toEqual([200, 404]);
    });
  });
});
