import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createReportResponseSchema,
  REPORT_NOTE_MAX_LENGTH,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
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
import { REPORT_DAILY_LIMIT, REPORT_LIMIT_WINDOW_MS } from './report-config';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho việc gửi báo cáo (Week11.md 5.3, D5). Chứng minh điều unit test với
// mock không chứng minh được: ma trận ai được báo gì (đánh giá / hội thoại / shop / sản phẩm, đối tượng không công khai, không phải
// thành viên, của chính mình), trọng tài khi gửi song song (chỉ mục duy nhất từng phần + khoá tư vấn), trần 10 báo cáo/24 giờ đếm bằng
// DB kể cả khi bắn song song, thông báo chỉ tới Admin ACTIVE, người bị báo không có đường nào thấy người báo, và ghi chú của người báo
// không vào log. Chạy: `pnpm test:int`.
const TAG = 'it-report-api-';
const PASSWORD = 'password123';
const URL = '/api/v1/reports';
const NUL = String.fromCharCode(0);
const fakeMail = createFakeMail();

describe('Gửi báo cáo vi phạm (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;
  const startedAt = new Date();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let anonymous: Agent;

  const observed = new Set<number>();

  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const dataOf = (res: { body: unknown }) =>
    (res.body as { data: unknown }).data;

  interface Account {
    agent: Agent;
    userId: string;
    email: string;
  }

  async function newAccount(
    options: { verified?: boolean } = {},
  ): Promise<Account> {
    const n = counter++;
    const email = `${TAG}${stamp}-${n}@test.local`;
    const agent = newAgent();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}user${n}` })
      .expect(201);
    const user = await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: options.verified === false ? null : new Date() },
      select: { id: true },
    });
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { agent, userId: user.id, email };
  }

  interface Store {
    owner: Account;
    shopId: string;
    productId: string;
    variantId: string;
  }

  async function newStore(
    options: {
      shopStatus?: 'APPROVED' | 'PENDING' | 'SUSPENDED';
      productStatus?: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
    } = {},
  ): Promise<Store> {
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
        status: options.shopStatus ?? 'APPROVED',
      },
      select: { id: true },
    });
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: category.id,
        name: `${TAG}product${n}`,
        slug: `${TAG}product-${stamp.toString(36)}-${n}`,
        status: options.productStatus ?? 'PUBLISHED',
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

  // Nhiều shop APPROVED chỉ để làm đối tượng bị báo (cho test trần), cùng một chủ.
  async function newShops(count: number): Promise<string[]> {
    const owner = await newAccount();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const shop = await prisma.shop.create({
        data: {
          ownerId: owner.userId,
          name: `${TAG}bulk${counter}-${i}`,
          slug: `${TAG}bulk-${stamp.toString(36)}-${counter++}-${i}`,
          status: 'APPROVED',
        },
        select: { id: true },
      });
      ids.push(shop.id);
    }
    return ids;
  }

  async function newReview(
    store: Store,
    author: Account,
    options: { comment?: string | null } = {},
  ): Promise<string> {
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
        comment: options.comment === undefined ? 'Hàng giả' : options.comment,
      },
      select: { id: true },
    });
    return review.id;
  }

  async function newConversation(
    store: Store,
    buyer: Account,
    options: { withMessage?: boolean; content?: string } = {},
  ): Promise<string> {
    const withMessage = options.withMessage ?? true;
    const conversation = await prisma.conversation.create({
      data: {
        buyerId: buyer.userId,
        shopId: store.shopId,
        lastMessageAt: withMessage ? new Date() : null,
      },
      select: { id: true },
    });
    if (withMessage) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: buyer.userId,
          content: options.content ?? 'Xin chào shop',
        },
      });
    }
    return conversation.id;
  }

  async function report(
    agent: Agent,
    payload: Record<string, unknown>,
  ): Promise<request.Response> {
    const res = await agent.post(URL).send(payload);
    observed.add(res.status);
    return res;
  }

  const rowsBy = (reporterId: string) =>
    prisma.report.findMany({
      where: { reporterId },
      orderBy: { createdAt: 'asc' },
    });
  const rowsFor = (targetId: string) =>
    prisma.report.findMany({ where: { targetId } });

  const payload = (
    targetType: string,
    targetId: string,
    reasonCode: string,
    note?: string,
  ) => ({ targetType, targetId, reasonCode, ...(note ? { note } : {}) });

  const closeAll = (reporterId: string) =>
    prisma.report.updateMany({
      where: { reporterId, status: 'OPEN' },
      data: {
        status: 'DISMISSED',
        resolvedById: randomUUID(),
        resolvedAt: new Date(),
        resolutionAction: 'DISMISS',
      },
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
    anonymous = newAgent();
  });

  afterEach(() => {
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Thông báo REPORT_NEW gửi cả cho Admin THẬT của DB dev (không mang tiền tố test): dọn phần của lượt này.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401 và không có báo cáo nào được tạo', async () => {
      const store = await newStore();

      const res = await report(
        anonymous,
        payload('SHOP', store.shopId, 'SCAM'),
      );

      expect(res.status).toBe(401);
      expect(await rowsFor(store.shopId)).toHaveLength(0);
    });

    it('email chưa xác thực ⇒ 403 EMAIL_NOT_VERIFIED, không có báo cáo nào được tạo', async () => {
      const store = await newStore();
      const unverified = await newAccount({ verified: false });

      const res = await report(
        unverified.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );

      expect([res.status, code(res)]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
      expect(await rowsFor(store.shopId)).toHaveLength(0);
    });

    it.each<[string, (id: string) => Record<string, unknown>]>([
      ['thiếu loại đối tượng', (id) => ({ targetId: id, reasonCode: 'SCAM' })],
      ['loại đối tượng lạ', (id) => payload('USER', id, 'SCAM')],
      [
        'thiếu id đối tượng',
        () => ({ targetType: 'SHOP', reasonCode: 'SCAM' }),
      ],
      ['id không phải UUID', () => payload('SHOP', 'not-a-uuid', 'SCAM')],
      ['id chứa ký tự NUL', () => payload('SHOP', `abc${NUL}`, 'SCAM')],
      ['thiếu lý do', (id) => ({ targetType: 'SHOP', targetId: id })],
      ['lý do lạ', (id) => payload('SHOP', id, 'NOT_A_REASON')],
      [
        'lý do của loại khác (FAKE_REVIEW cho shop)',
        (id) => payload('SHOP', id, 'FAKE_REVIEW'),
      ],
      ['OTHER không có ghi chú', (id) => payload('SHOP', id, 'OTHER')],
      [
        'OTHER với ghi chú toàn khoảng trắng',
        (id) => payload('SHOP', id, 'OTHER', '   '),
      ],
      [
        'ghi chú quá 500 ký tự',
        (id) => payload('SHOP', id, 'SCAM', 'a'.repeat(501)),
      ],
      [
        'ghi chú có ký tự điều khiển',
        (id) => payload('SHOP', id, 'SCAM', `abc${NUL}def`),
      ],
    ])('%s ⇒ 400 và không có báo cáo nào được tạo', async (_name, make) => {
      const store = await newStore();
      const reporter = await newAccount();

      const res = await report(reporter.agent, make(store.shopId));

      expect(res.status).toBe(400);
      expect(await rowsBy(reporter.userId)).toHaveLength(0);
    });

    it('ghi chú đúng 500 ký tự và lý do OTHER có ghi chú thì qua', async () => {
      const store = await newStore();
      const reporter = await newAccount();

      const long = await report(
        reporter.agent,
        payload(
          'SHOP',
          store.shopId,
          'SCAM',
          'a'.repeat(REPORT_NOTE_MAX_LENGTH),
        ),
      );
      const other = await report(
        reporter.agent,
        payload('PRODUCT', store.productId, 'OTHER', 'Quảng cáo ngoài sàn'),
      );

      expect([long.status, other.status]).toEqual([201, 201]);
    });

    it('người báo, trạng thái, ảnh chụp, người xử lý và thời điểm KHÔNG đặt được từ client', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const other = await newAccount();

      const res = await report(reporter.agent, {
        ...payload('SHOP', store.shopId, 'SCAM', 'Lừa đảo'),
        reporterId: other.userId,
        status: 'RESOLVED',
        snapshot: { name: 'GIẢ', slug: 'gia' },
        resolvedById: other.userId,
        resolutionAction: 'DISMISS',
        createdAt: '2020-01-01T00:00:00.000Z',
      });

      expect(res.status).toBe(201);
      const [row] = await rowsBy(reporter.userId);
      expect(row).toMatchObject({
        reporterId: reporter.userId,
        status: 'OPEN',
        resolvedById: null,
        resolutionAction: null,
        resolvedAt: null,
      });
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: store.shopId },
        select: { name: true, slug: true },
      });
      expect(row.snapshot).toEqual({ name: shop.name, slug: shop.slug });
      expect(JSON.stringify(row.snapshot)).not.toContain('GIẢ');
      expect(row.createdAt.getFullYear()).toBeGreaterThan(2020);
      expect(await rowsBy(other.userId)).toHaveLength(0);
    });
  });

  describe('báo cáo từng loại đối tượng', () => {
    it('SHOP: người ngoài báo được; biên nhận chỉ có bốn trường; ảnh chụp có tên và slug của shop', async () => {
      const store = await newStore();
      const reporter = await newAccount();

      const res = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'COUNTERFEIT', 'Bán hàng nhái'),
      );

      expect(res.status).toBe(201);
      const parsed = createReportResponseSchema.parse(dataOf(res));
      expect(
        Object.keys((dataOf(res) as { report: object }).report).sort(),
      ).toEqual(['createdAt', 'id', 'status', 'targetType']);
      expect(parsed.report).toMatchObject({
        targetType: 'SHOP',
        status: 'OPEN',
      });
      const [row] = await rowsBy(reporter.userId);
      expect(row).toMatchObject({
        id: parsed.report.id,
        targetType: 'SHOP',
        targetId: store.shopId,
        reasonCode: 'COUNTERFEIT',
        note: 'Bán hàng nhái',
      });
      expect(Object.keys(row.snapshot as object).sort()).toEqual([
        'name',
        'slug',
      ]);
    });

    it('PRODUCT: người ngoài báo được; ảnh chụp có tên sản phẩm và tên shop', async () => {
      const store = await newStore();
      const reporter = await newAccount();

      const res = await report(
        reporter.agent,
        payload('PRODUCT', store.productId, 'PROHIBITED_ITEM'),
      );

      expect(res.status).toBe(201);
      const [row] = await rowsBy(reporter.userId);
      expect(Object.keys(row.snapshot as object).sort()).toEqual([
        'name',
        'shopName',
      ]);
      expect(row.note).toBeNull();
    });

    it('REVIEW: người ngoài báo được; ảnh chụp lưu NGUYÊN VĂN đánh giá, tên tác giả và id sản phẩm', async () => {
      const store = await newStore();
      const author = await newAccount();
      const reporter = await newAccount();
      const reviewId = await newReview(store, author, {
        comment: 'Hàng giả.\nShop lừa đảo.',
      });

      const res = await report(
        reporter.agent,
        payload('REVIEW', reviewId, 'FAKE_REVIEW'),
      );

      expect(res.status).toBe(201);
      const [row] = await rowsBy(reporter.userId);
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: store.productId },
        select: { name: true },
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: author.userId },
        select: { name: true },
      });
      expect(row.snapshot).toEqual({
        productId: store.productId,
        productName: product.name,
        rating: 1,
        comment: 'Hàng giả.\nShop lừa đảo.',
        authorName: user.name,
      });
    });

    it('REVIEW: chủ shop báo đánh giá trên hàng của mình được, kể cả khi sản phẩm không còn công khai', async () => {
      const store = await newStore({ productStatus: 'ARCHIVED' });
      const author = await newAccount();
      const reviewId = await newReview(store, author);

      const res = await report(
        store.owner.agent,
        payload('REVIEW', reviewId, 'OFFENSIVE_LANGUAGE'),
      );

      expect(res.status).toBe(201);
    });

    it('REVIEW: người ngoài không báo được đánh giá của sản phẩm không còn công khai ⇒ 404', async () => {
      const store = await newStore({ productStatus: 'DRAFT' });
      const author = await newAccount();
      const stranger = await newAccount();
      const reviewId = await newReview(store, author);

      const res = await report(
        stranger.agent,
        payload('REVIEW', reviewId, 'SPAM'),
      );

      expect([res.status, code(res)]).toEqual([404, 'REPORT_TARGET_NOT_FOUND']);
    });

    it('CONVERSATION: người mua báo ⇒ vai BUYER; chủ shop báo ⇒ vai SHOP; ảnh chụp KHÔNG có nội dung tin nhắn', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const canary = `CANARY-TIN-NHAN-${randomUUID()}`;
      const conversationId = await newConversation(store, buyer, {
        content: canary,
      });

      const byBuyer = await report(
        buyer.agent,
        payload('CONVERSATION', conversationId, 'HARASSMENT'),
      );
      const byShop = await report(
        store.owner.agent,
        payload('CONVERSATION', conversationId, 'SPAM'),
      );

      expect([byBuyer.status, byShop.status]).toEqual([201, 201]);
      const rows = await rowsFor(conversationId);
      expect(rows).toHaveLength(2);
      const roles = rows
        .map((r) => (r.snapshot as { reporterRole: string }).reporterRole)
        .sort();
      expect(roles).toEqual(['BUYER', 'SHOP']);
      for (const row of rows) {
        expect(Object.keys(row.snapshot as object).sort()).toEqual([
          'buyerName',
          'reporterRole',
          'shopName',
        ]);
        expect(JSON.stringify(row)).not.toContain(canary);
      }
    });

    it('CONVERSATION: shop đã bị khoá vẫn báo được (hội thoại chỉ-đọc)', async () => {
      const store = await newStore({ shopStatus: 'SUSPENDED' });
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer);

      const res = await report(
        buyer.agent,
        payload('CONVERSATION', conversationId, 'SCAM'),
      );

      expect(res.status).toBe(201);
    });
  });

  describe('đối tượng không thấy được ⇒ cùng MỘT 404', () => {
    it('id không tồn tại ở cả bốn loại: cùng status, cùng mã, cùng body', async () => {
      const reporter = await newAccount();
      const reasons = {
        REVIEW: 'SPAM',
        CONVERSATION: 'SPAM',
        SHOP: 'SCAM',
        PRODUCT: 'COUNTERFEIT',
      } as const;

      const bodies: unknown[] = [];
      for (const [targetType, reasonCode] of Object.entries(reasons)) {
        const res = await report(
          reporter.agent,
          payload(targetType, randomUUID(), reasonCode),
        );
        expect([targetType, res.status, code(res)]).toEqual([
          targetType,
          404,
          'REPORT_TARGET_NOT_FOUND',
        ]);
        bodies.push(res.body);
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(await rowsBy(reporter.userId)).toHaveLength(0);
    });

    it('hội thoại có thật nhưng người báo không phải thành viên ⇒ y hệt hội thoại không tồn tại (không dò được)', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const stranger = await newAccount();
      const conversationId = await newConversation(store, buyer);

      const real = await report(
        stranger.agent,
        payload('CONVERSATION', conversationId, 'SPAM'),
      );
      const missing = await report(
        stranger.agent,
        payload('CONVERSATION', randomUUID(), 'SPAM'),
      );

      expect(real.status).toBe(404);
      expect(real.body).toEqual(missing.body);
      expect(await rowsFor(conversationId)).toHaveLength(0);
    });

    it('hội thoại chưa có tin nào (không hiện ở cả hai phía) ⇒ 404 kể cả với thành viên', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const conversationId = await newConversation(store, buyer, {
        withMessage: false,
      });

      const res = await report(
        buyer.agent,
        payload('CONVERSATION', conversationId, 'SPAM'),
      );

      expect(res.status).toBe(404);
    });

    it.each(['PENDING', 'SUSPENDED'] as const)(
      'shop %s không công khai ⇒ 404 với người ngoài lẫn chính chủ (không dò được trạng thái)',
      async (shopStatus) => {
        const store = await newStore({ shopStatus });
        const stranger = await newAccount();

        const byStranger = await report(
          stranger.agent,
          payload('SHOP', store.shopId, 'SCAM'),
        );
        const byOwner = await report(
          store.owner.agent,
          payload('SHOP', store.shopId, 'SCAM'),
        );

        expect([byStranger.status, byOwner.status]).toEqual([404, 404]);
        expect(byStranger.body).toEqual(byOwner.body);
      },
    );

    it.each(['DRAFT', 'ARCHIVED'] as const)(
      'sản phẩm %s ⇒ 404',
      async (productStatus) => {
        const store = await newStore({ productStatus });
        const stranger = await newAccount();

        const res = await report(
          stranger.agent,
          payload('PRODUCT', store.productId, 'COUNTERFEIT'),
        );

        expect(res.status).toBe(404);
      },
    );

    it('sản phẩm PUBLISHED của shop không còn APPROVED ⇒ 404', async () => {
      const store = await newStore({ shopStatus: 'SUSPENDED' });
      const stranger = await newAccount();

      const res = await report(
        stranger.agent,
        payload('PRODUCT', store.productId, 'COUNTERFEIT'),
      );

      expect(res.status).toBe(404);
    });
  });

  describe('không tự báo nội dung của chính mình ⇒ 409 REPORT_OWN_CONTENT', () => {
    it('tác giả báo đánh giá của mình', async () => {
      const store = await newStore();
      const author = await newAccount();
      const reviewId = await newReview(store, author);

      const res = await report(
        author.agent,
        payload('REVIEW', reviewId, 'SPAM'),
      );

      expect([res.status, code(res)]).toEqual([409, 'REPORT_OWN_CONTENT']);
      expect(await rowsBy(author.userId)).toHaveLength(0);
    });

    it('chủ shop báo shop và sản phẩm của mình', async () => {
      const store = await newStore();

      const shop = await report(
        store.owner.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );
      const product = await report(
        store.owner.agent,
        payload('PRODUCT', store.productId, 'COUNTERFEIT'),
      );

      expect([shop.status, code(shop)]).toEqual([409, 'REPORT_OWN_CONTENT']);
      expect([product.status, code(product)]).toEqual([
        409,
        'REPORT_OWN_CONTENT',
      ]);
      expect(await rowsBy(store.owner.userId)).toHaveLength(0);
    });
  });

  describe('trùng báo cáo', () => {
    it('báo cáo ĐANG MỞ thứ hai cùng đối tượng ⇒ 409 REPORT_ALREADY_OPEN, vẫn chỉ một hàng', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      expect(
        (await report(reporter.agent, payload('SHOP', store.shopId, 'SCAM')))
          .status,
      ).toBe(201);

      const again = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'COUNTERFEIT'),
      );

      expect([again.status, code(again)]).toEqual([409, 'REPORT_ALREADY_OPEN']);
      expect(await rowsFor(store.shopId)).toHaveLength(1);
    });

    it('sau khi Admin đóng báo cáo, cùng người báo lại được; người khác báo cùng đối tượng cũng được (nhiều báo cáo mở)', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const second = await newAccount();
      await report(reporter.agent, payload('SHOP', store.shopId, 'SCAM'));
      await closeAll(reporter.userId);

      const reopened = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );
      const other = await report(
        second.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );

      expect([reopened.status, other.status]).toEqual([201, 201]);
      const states = (await rowsFor(store.shopId)).map((r) => r.status).sort();
      expect(states).toEqual(['DISMISSED', 'OPEN', 'OPEN']);
    });

    it('tám yêu cầu ĐỒNG THỜI cùng một báo cáo: đúng một cái thắng, bảy cái còn lại 409 REPORT_ALREADY_OPEN', async () => {
      const store = await newStore();
      const reporter = await newAccount();

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          report(reporter.agent, payload('SHOP', store.shopId, 'SCAM')),
        ),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(code(res)).toBe('REPORT_ALREADY_OPEN');
      }
      expect(await rowsFor(store.shopId)).toHaveLength(1);
    });
  });

  describe(`trần ${REPORT_DAILY_LIMIT} báo cáo / 24 giờ (đếm bằng DB)`, () => {
    it('báo cáo thứ 11 ⇒ 429 REPORT_LIMIT_REACHED; người báo khác không bị ảnh hưởng', async () => {
      const shops = await newShops(REPORT_DAILY_LIMIT + 1);
      const reporter = await newAccount();
      const bystander = await newAccount();
      for (const shopId of shops.slice(0, REPORT_DAILY_LIMIT)) {
        const ok = await report(
          reporter.agent,
          payload('SHOP', shopId, 'SCAM'),
        );
        expect(ok.status).toBe(201);
      }

      const over = await report(
        reporter.agent,
        payload('SHOP', shops[REPORT_DAILY_LIMIT], 'SCAM'),
      );
      const other = await report(
        bystander.agent,
        payload('SHOP', shops[REPORT_DAILY_LIMIT], 'SCAM'),
      );

      expect([over.status, code(over)]).toEqual([429, 'REPORT_LIMIT_REACHED']);
      expect(other.status).toBe(201);
      expect(await rowsBy(reporter.userId)).toHaveLength(REPORT_DAILY_LIMIT);
    });

    it('báo cáo đã được đóng VẪN tính vào trần (Admin bỏ qua hàng loạt không mở ra thêm lượt)', async () => {
      const shops = await newShops(REPORT_DAILY_LIMIT + 1);
      const reporter = await newAccount();
      for (const shopId of shops.slice(0, REPORT_DAILY_LIMIT)) {
        await report(reporter.agent, payload('SHOP', shopId, 'SCAM'));
      }
      await closeAll(reporter.userId);

      const res = await report(
        reporter.agent,
        payload('SHOP', shops[REPORT_DAILY_LIMIT], 'SCAM'),
      );

      expect([res.status, code(res)]).toEqual([429, 'REPORT_LIMIT_REACHED']);
    });

    it('báo cáo cũ hơn 24 giờ ra khỏi cửa sổ trượt: có chỗ cho báo cáo mới', async () => {
      const shops = await newShops(REPORT_DAILY_LIMIT + 1);
      const reporter = await newAccount();
      for (const shopId of shops.slice(0, REPORT_DAILY_LIMIT)) {
        await report(reporter.agent, payload('SHOP', shopId, 'SCAM'));
      }
      const [oldest] = await rowsBy(reporter.userId);
      await prisma.report.update({
        where: { id: oldest.id },
        data: {
          createdAt: new Date(Date.now() - REPORT_LIMIT_WINDOW_MS - 60_000),
        },
      });

      const res = await report(
        reporter.agent,
        payload('SHOP', shops[REPORT_DAILY_LIMIT], 'SCAM'),
      );

      expect(res.status).toBe(201);
    });

    it('người đang ở sát trần mà báo trùng thấy REPORT_ALREADY_OPEN (câu trả lời đúng), không phải "quá trần"', async () => {
      const shops = await newShops(REPORT_DAILY_LIMIT);
      const reporter = await newAccount();
      for (const shopId of shops) {
        await report(reporter.agent, payload('SHOP', shopId, 'SCAM'));
      }

      const again = await report(
        reporter.agent,
        payload('SHOP', shops[0], 'SCAM'),
      );

      expect([again.status, code(again)]).toEqual([409, 'REPORT_ALREADY_OPEN']);
    });

    it(`${REPORT_DAILY_LIMIT + 5} yêu cầu ĐỒNG THỜI về ${REPORT_DAILY_LIMIT + 5} đối tượng khác nhau: đúng ${REPORT_DAILY_LIMIT} thắng, phần còn lại 429 (khoá tư vấn, không phải kiểm trước)`, async () => {
      const extra = 5;
      const shops = await newShops(REPORT_DAILY_LIMIT + extra);
      const reporter = await newAccount();

      const results = await Promise.all(
        shops.map((shopId) =>
          report(reporter.agent, payload('SHOP', shopId, 'SCAM')),
        ),
      );

      const created = results.filter((r) => r.status === 201);
      const limited = results.filter((r) => r.status === 429);
      expect(created).toHaveLength(REPORT_DAILY_LIMIT);
      expect(limited).toHaveLength(extra);
      for (const res of limited) expect(code(res)).toBe('REPORT_LIMIT_REACHED');
      expect(await rowsBy(reporter.userId)).toHaveLength(REPORT_DAILY_LIMIT);
    });
  });

  describe('thông báo cho Admin', () => {
    it('mọi Admin ACTIVE nhận REPORT_NEW với đúng id báo cáo và loại đối tượng; Admin bị khoá, người báo và người bị báo thì không', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const activeAdmin = await prisma.user.create({
        data: {
          email: `${TAG}${stamp}-admin-active@test.local`,
          name: `${TAG}admin-active`,
          role: 'ADMIN',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      const suspendedAdmin = await prisma.user.create({
        data: {
          email: `${TAG}${stamp}-admin-suspended@test.local`,
          name: `${TAG}admin-suspended`,
          role: 'ADMIN',
          accountStatus: 'SUSPENDED',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });

      const res = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM', 'GHI-CHU-RIENG-TU-CUA-NGUOI-BAO'),
      );

      expect(res.status).toBe(201);
      const reportId = createReportResponseSchema.parse(dataOf(res)).report.id;
      const forAdmin = await prisma.notification.findMany({
        where: { userId: activeAdmin.id },
      });
      expect(forAdmin).toHaveLength(1);
      expect(forAdmin[0]).toMatchObject({ type: 'REPORT_NEW' });
      expect(forAdmin[0].data).toEqual({ reportId, targetType: 'SHOP' });
      expect(
        await prisma.notification.count({
          where: { userId: suspendedAdmin.id },
        }),
      ).toBe(0);
      // Người báo và người bị báo (chủ shop) không nhận thông báo nào về việc này.
      for (const userId of [reporter.userId, store.owner.userId]) {
        expect(
          await prisma.notification.count({
            where: { userId, type: 'REPORT_NEW' },
          }),
        ).toBe(0);
      }
      expect(JSON.stringify(forAdmin)).not.toMatch(
        /GHI-CHU-RIENG-TU|reporterId|@test\.local/,
      );
    });

    it('báo cáo bị từ chối (400/404/409/429) không phát thông báo nào', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const since = new Date();

      await report(reporter.agent, payload('SHOP', 'not-a-uuid', 'SCAM'));
      await report(reporter.agent, payload('SHOP', randomUUID(), 'SCAM'));
      await report(store.owner.agent, payload('SHOP', store.shopId, 'SCAM'));

      expect(
        await prisma.notification.count({
          where: { type: 'REPORT_NEW', createdAt: { gte: since } },
        }),
      ).toBe(0);
    });
  });

  describe('người bị báo không có đường nào thấy người báo', () => {
    it('không có route đọc báo cáo nào ở phía người dùng (GET /reports và /reports/:id ⇒ 404 cho mọi người)', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      const res = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );
      const reportId = createReportResponseSchema.parse(dataOf(res)).report.id;

      for (const agent of [reporter.agent, store.owner.agent, anonymous]) {
        for (const path of [URL, `${URL}/${reportId}`, `${URL}/me`]) {
          const read = await agent.get(path);
          expect([path, read.status]).toEqual([path, 404]);
        }
      }
    });

    it('hộp thông báo của người bị báo không có dấu vết nào của báo cáo hay người báo', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM', 'GHI-CHU-RIENG-TU-CUA-NGUOI-BAO'),
      );

      const inbox = await store.owner.agent.get('/api/v1/notifications');

      expect(inbox.status).toBe(200);
      const text = JSON.stringify(inbox.body);
      expect(text).not.toMatch(/REPORT_/);
      expect(text).not.toContain(reporter.userId);
      expect(text).not.toContain(reporter.email);
      expect(text).not.toContain('GHI-CHU-RIENG-TU');
    });

    it('trang shop công khai của người bị báo không lộ báo cáo', async () => {
      const store = await newStore();
      const reporter = await newAccount();
      await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM', 'GHI-CHU-RIENG-TU-CUA-NGUOI-BAO'),
      );
      const slug = (
        await prisma.shop.findUniqueOrThrow({
          where: { id: store.shopId },
          select: { slug: true },
        })
      ).slug;

      const page = await store.owner.agent.get(`/api/v1/shops/${slug}`);

      const text = JSON.stringify(page.body);
      expect(text).not.toContain(reporter.userId);
      expect(text).not.toContain(reporter.email);
      expect(text).not.toContain('GHI-CHU-RIENG-TU');
    });
  });

  describe('log không bao giờ chứa ghi chú của người báo', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const store = await newStore();
      const reporter = await newAccount();
      const shops = await newShops(3);
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
        await reporter.agent
          .post(URL)
          .send(
            payload('SHOP', store.shopId, 'SCAM', `${canary} ghi chú thường`),
          );
        // 2. sai dữ liệu: quá dài, chứa canary
        await reporter.agent
          .post(URL)
          .send(
            payload(
              'SHOP',
              shops[0],
              'SCAM',
              `${canary}${'x'.repeat(REPORT_NOTE_MAX_LENGTH + 1)}`,
            ),
          );
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả ghi chú)
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { note: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await reporter.agent
          .post(URL)
          .send(payload('SHOP', shops[1], 'SCAM', `${canary} lỗi Prisma`));
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(new Error('db down'));
        down = await reporter.agent
          .post(URL)
          .send(payload('SHOP', shops[2], 'SCAM', `${canary} DB sập`));
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
      // ...nhưng không có ghi chú của người báo.
      expect(logs).not.toContain(canary);
    });
  });

  describe('header và tài liệu API', () => {
    it('trả Cache-Control: no-store', async () => {
      const store = await newStore();
      const reporter = await newAccount();

      const res = await report(
        reporter.agent,
        payload('SHOP', store.shopId, 'SCAM'),
      );

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('Swagger khớp hành vi thật: POST khai báo đúng 201 và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('report').setVersion('0').build(),
      );
      const path = document.paths['/api/v1/reports'] as
        Record<string, { responses: Record<string, unknown> }> | undefined;

      const operation = path?.post;
      expect(operation).toBeDefined();
      const documented = Object.keys(operation?.responses ?? {}).map(Number);
      expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([201]);
      // 500 chỉ do test cố ý phá lúc ghi, không phải hành vi cần tài liệu.
      for (const status of [...observed].filter((s) => s !== 500)) {
        expect(documented).toEqual(expect.arrayContaining([status]));
      }
      expect([...observed].filter((s) => s !== 500).sort()).toEqual([
        201, 400, 401, 403, 404, 409, 429,
      ]);
    });
  });
});
