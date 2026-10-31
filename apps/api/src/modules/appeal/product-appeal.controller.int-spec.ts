import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  APPEAL_MESSAGE_MAX_LENGTH,
  notificationContentSchema,
  productAppealsResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho kháng nghị lần gỡ sản phẩm của chủ shop (Week11.md 5.8, D15). Chứng minh
// điều unit test với mock không chứng minh được: ma trận ai được kháng nghị khi nào (chỉ sản phẩm ĐANG bị gỡ của CHÍNH shop), sản phẩm của
// shop khác / không tồn tại / sai dạng ra cùng một 404, mỗi lần bị gỡ chỉ MỘT kháng nghị kể cả khi gửi song song, khoá FOR SHARE chặn kháng
// nghị gắn vào lần gỡ vừa kết thúc, mốc bị xử lý lấy từ server (`taken_down_at`), kết quả Admin hiện cho chủ shop, thông báo không mang lời
// kháng nghị, và lời kháng nghị không vào log. Chạy: `pnpm test:int`.
const TAG = 'it-product-appeal-';
const PASSWORD = 'password123';
const REASON = 'Bán hàng cấm: dao bấm tự động lò xo';
const fakeMail = createFakeMail();

describe('Kháng nghị sản phẩm bị gỡ của chủ shop (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let adminId: string;
  let anonymous: Agent;
  const startedAt = new Date();

  const observed = { get: new Set<number>(), post: new Set<number>() };

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const urlOf = (shopId: string, productId: string) =>
    `/api/v1/shops/${shopId}/products/${productId}/appeals`;

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function list(agent: Agent, shopId: string, productId: string) {
    const res = await agent.get(urlOf(shopId, productId));
    observed.get.add(res.status);
    return res;
  }

  async function appeal(
    agent: Agent,
    shopId: string,
    productId: string,
    message: unknown,
  ) {
    const res = await agent.post(urlOf(shopId, productId)).send({ message });
    observed.post.add(res.status);
    return res;
  }

  interface Store {
    agent: Agent;
    userId: string;
    shopId: string;
    productId: string;
  }

  // Một chủ shop đăng nhập được (email đã xác thực) kèm một shop APPROVED và một sản phẩm. `verified: false` để thử cổng email.
  async function newStore(
    options: {
      verified?: boolean;
      productStatus?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    } = {},
  ): Promise<Store> {
    const n = counter++;
    const email = `${TAG}${stamp}-${n}@test.local`;
    const agent = newAgent();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}owner${n}` })
      .expect(201);
    const user = await prisma.user.update({
      where: { email },
      data: {
        emailVerifiedAt: options.verified === false ? null : new Date(),
      },
      select: { id: true },
    });
    await loginAs(agent, email);
    const shop = await prisma.shop.create({
      data: {
        ownerId: user.id,
        name: `${TAG}shop${n}`,
        slug: `${TAG}shop-${stamp.toString(36)}-${n}`,
        status: 'APPROVED',
      },
      select: { id: true },
    });
    const category = await prisma.category.create({
      data: {
        name: `${TAG}cat${n}`,
        slug: `${TAG}cat-${stamp.toString(36)}-${n}`,
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
    return {
      agent,
      userId: user.id,
      shopId: shop.id,
      productId: product.id,
    };
  }

  async function takeDown(productId: string): Promise<void> {
    const res = await admin
      .post(`/api/v1/admin/products/${productId}/take-down`)
      .send({ reason: REASON });
    expect([productId, res.status]).toEqual([productId, 200]);
  }

  async function restore(productId: string): Promise<void> {
    const res = await admin
      .post(`/api/v1/admin/products/${productId}/restore`)
      .send({ reason: 'Đã xem xét lại' });
    expect([productId, res.status]).toEqual([productId, 200]);
  }

  // Sản phẩm bị Admin gỡ THẬT qua API (có ba cột gỡ và takenDownAt thật).
  async function newTakenDownStore(): Promise<Store> {
    const store = await newStore();
    await takeDown(store.productId);
    return store;
  }

  const productOf = (productId: string) =>
    prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const rowsOf = (productId: string) =>
    prisma.appeal.findMany({
      where: { targetId: productId },
      orderBy: { moderationEventAt: 'asc' },
    });
  const readOf = async (store: Store) =>
    productAppealsResponseSchema.parse(
      data(await list(store.agent, store.shopId, store.productId)),
    );

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

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401 — cả đọc lẫn ghi', async () => {
      const { shopId, productId } = await newTakenDownStore();

      expect((await list(anonymous, shopId, productId)).status).toBe(401);
      expect((await appeal(anonymous, shopId, productId, 'x')).status).toBe(
        401,
      );
      expect(await rowsOf(productId)).toHaveLength(0);
    });

    it('không phải chủ shop 403 (kể cả Admin) — đọc lẫn ghi, và không có kháng nghị nào được tạo', async () => {
      const victim = await newTakenDownStore();
      const stranger = await newStore();

      for (const agent of [stranger.agent, admin]) {
        expect(
          (await list(agent, victim.shopId, victim.productId)).status,
        ).toBe(403);
        expect(
          (await appeal(agent, victim.shopId, victim.productId, 'xin xem xét'))
            .status,
        ).toBe(403);
      }
      expect(await rowsOf(victim.productId)).toHaveLength(0);
    });

    it('shop không tồn tại ⇒ 404', async () => {
      const { agent, productId } = await newTakenDownStore();

      expect((await list(agent, randomUUID(), productId)).status).toBe(404);
      expect((await appeal(agent, randomUUID(), productId, 'x')).status).toBe(
        404,
      );
    });

    it('email chưa xác thực: ghi bị chặn 403 EMAIL_NOT_VERIFIED, đọc vẫn được', async () => {
      const store = await newStore({ verified: false });
      await takeDown(store.productId);

      const read = await list(store.agent, store.shopId, store.productId);
      const write = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );

      expect(read.status).toBe(200);
      expect([write.status, code(write)]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
      expect(await rowsOf(store.productId)).toHaveLength(0);
    });

    it.each([
      ['thiếu lời kháng nghị', undefined],
      ['rỗng', ''],
      ['chỉ khoảng trắng', '  \n  '],
      ['không phải chuỗi', 123],
      ['quá 1000 ký tự', 'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1)],
      ['có NUL', 'abc\u0000def'],
      ['có ký tự bidi-override', 'abc‮def'],
    ])(
      'ghi: %s ⇒ 400 và không có kháng nghị nào được tạo',
      async (_n, message) => {
        const store = await newTakenDownStore();

        const res = await appeal(
          store.agent,
          store.shopId,
          store.productId,
          message,
        );

        expect(res.status).toBe(400);
        expect(await rowsOf(store.productId)).toHaveLength(0);
      },
    );
  });

  describe('sản phẩm không xem được: một 404 duy nhất', () => {
    it('sản phẩm của shop KHÁC, sản phẩm không tồn tại và id sai dạng cho CÙNG status và CÙNG body (không dò được sản phẩm của người khác)', async () => {
      const mine = await newStore();
      const other = await newTakenDownStore();
      const nul = '%00';

      const responses = [
        // sản phẩm có thật nhưng thuộc shop khác, qua shop CỦA MÌNH
        await list(mine.agent, mine.shopId, other.productId),
        await appeal(mine.agent, mine.shopId, other.productId, 'mạo danh'),
        // sản phẩm không tồn tại
        await list(mine.agent, mine.shopId, randomUUID()),
        await appeal(mine.agent, mine.shopId, randomUUID(), 'x'),
        // id sai dạng, kể cả có NUL mà Postgres không nhận
        await list(mine.agent, mine.shopId, 'khong-phai-uuid'),
        await appeal(mine.agent, mine.shopId, 'khong-phai-uuid', 'x'),
        await list(mine.agent, mine.shopId, `${mine.productId}${nul}`),
        await appeal(mine.agent, mine.shopId, `${mine.productId}${nul}`, 'x'),
      ];

      expect(responses.map((res) => res.status)).toEqual(Array(8).fill(404));
      const bodies = responses.map((res) => JSON.stringify(res.body));
      expect(new Set(bodies).size).toBe(1);
      expect(await rowsOf(other.productId)).toHaveLength(0);
    });

    it('chủ shop A không kháng nghị được sản phẩm của shop B qua đường dẫn của B (403) và không thấy kháng nghị của B', async () => {
      const a = await newTakenDownStore();
      const b = await newTakenDownStore();
      await appeal(b.agent, b.shopId, b.productId, 'của B');

      const crossRead = await list(a.agent, b.shopId, b.productId);
      const crossWrite = await appeal(
        a.agent,
        b.shopId,
        b.productId,
        'mạo danh',
      );

      expect(crossRead.status).toBe(403);
      expect(crossWrite.status).toBe(403);
      expect(JSON.stringify(crossRead.body)).not.toContain('của B');
      expect(await rowsOf(b.productId)).toHaveLength(1);
      expect(await rowsOf(a.productId)).toHaveLength(0);
    });
  });

  describe('ai được kháng nghị khi nào', () => {
    it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
      'sản phẩm %s (không bị gỡ) ⇒ 409 APPEAL_NOT_ALLOWED và canAppeal=false',
      async (productStatus) => {
        const store = await newStore({ productStatus });

        const read = await readOf(store);
        const res = await appeal(
          store.agent,
          store.shopId,
          store.productId,
          'xin xem xét',
        );

        expect(read).toEqual({ appeals: [], canAppeal: false });
        expect([res.status, code(res)]).toEqual([409, 'APPEAL_NOT_ALLOWED']);
        expect(await rowsOf(store.productId)).toHaveLength(0);
      },
    );

    it('sản phẩm bị gỡ ⇒ canAppeal=true; gửi được (201) và mốc bị xử lý LẤY TỪ SERVER = taken_down_at, người gửi = chủ shop của phiên', async () => {
      const store = await newTakenDownStore();
      const before = await readOf(store);

      const res = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        '  Đã bổ sung giấy tờ  ',
      );
      const after = await readOf(store);
      const product = await productOf(store.productId);
      const [row] = await rowsOf(store.productId);

      expect(before).toEqual({ appeals: [], canAppeal: true });
      expect(res.status).toBe(201);
      expect(product.takenDownAt).not.toBeNull();
      expect(row).toMatchObject({
        targetType: 'PRODUCT',
        targetId: store.productId,
        appellantId: store.userId,
        message: 'Đã bổ sung giấy tờ',
        status: 'PENDING',
      });
      expect(row.moderationEventAt.getTime()).toBe(
        product.takenDownAt?.getTime(),
      );
      expect(after.canAppeal).toBe(false);
      expect(after.appeals[0]).toMatchObject({
        id: row.id,
        state: 'PENDING',
        message: 'Đã bổ sung giấy tờ',
        decisionNote: null,
      });
    });

    it('client không đặt được người gửi, đối tượng hay mốc bằng body (trường lạ bị bỏ qua, mốc vẫn là taken_down_at)', async () => {
      const store = await newTakenDownStore();
      const other = await newStore();

      const res = await store.agent
        .post(urlOf(store.shopId, store.productId))
        .send({
          message: 'xin xem xét',
          appellantId: other.userId,
          targetType: 'SHOP',
          targetId: other.shopId,
          moderationEventAt: '2020-01-01T00:00:00.000Z',
          status: 'ACCEPTED',
        });
      const [row] = await rowsOf(store.productId);
      const product = await productOf(store.productId);

      expect([res.status, row.status]).toEqual([201, 'PENDING']);
      expect(row).toMatchObject({
        targetType: 'PRODUCT',
        targetId: store.productId,
        appellantId: store.userId,
      });
      expect(row.moderationEventAt.getTime()).toBe(
        product.takenDownAt?.getTime(),
      );
      expect(await rowsOf(other.shopId)).toHaveLength(0);
    });

    it('response gửi kháng nghị đúng allowlist: không lộ người kháng nghị, người quyết định hay id đối tượng', async () => {
      const store = await newTakenDownStore();

      const res = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );

      expect(Object.keys(data(res) as object).sort()).toEqual([
        'createdAt',
        'decidedAt',
        'decisionNote',
        'id',
        'message',
        'moderationEventAt',
        'state',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(
        /appellantId|decidedById|targetId|targetType/,
      );
    });

    it('trạng thái SHOP không ảnh hưởng: shop đang bị khoá thì chủ shop vẫn kháng nghị được sản phẩm bị gỡ của mình', async () => {
      const store = await newTakenDownStore();
      await prisma.shop.update({
        where: { id: store.shopId },
        data: { status: 'SUSPENDED', statusChangedAt: new Date() },
      });

      const read = await readOf(store);
      const res = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );

      expect(read.canAppeal).toBe(true);
      expect(res.status).toBe(201);
    });
  });

  describe('mỗi lần bị gỡ chỉ MỘT kháng nghị', () => {
    it('gửi lần hai trong cùng lần gỡ ⇒ 409 APPEAL_ALREADY_SENT, canAppeal=false, chỉ một hàng', async () => {
      const store = await newTakenDownStore();
      await appeal(store.agent, store.shopId, store.productId, 'lần một');

      const second = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'lần hai',
      );

      expect([second.status, code(second)]).toEqual([
        409,
        'APPEAL_ALREADY_SENT',
      ]);
      expect((await readOf(store)).canAppeal).toBe(false);
      expect(await rowsOf(store.productId)).toHaveLength(1);
    });

    it('gửi SONG SONG nhiều lần: đúng một 201, còn lại 409 APPEAL_ALREADY_SENT (UNIQUE là trọng tài), đúng một hàng', async () => {
      const store = await newTakenDownStore();

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          appeal(store.agent, store.shopId, store.productId, `lần ${index}`),
        ),
      );

      expect(results.map((res) => res.status).sort()).toEqual([
        201, 409, 409, 409, 409, 409,
      ]);
      expect(
        results.filter((res) => res.status === 409).map((res) => code(res)),
      ).toEqual(Array(5).fill('APPEAL_ALREADY_SENT'));
      expect(await rowsOf(store.productId)).toHaveLength(1);
    });

    it('gỡ → khôi phục → gỡ lại: kháng nghị cũ thành CLOSED và được gửi ĐÚNG MỘT kháng nghị mới cho lần gỡ mới', async () => {
      const store = await newTakenDownStore();
      await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'lần gỡ thứ nhất',
      );

      await restore(store.productId);
      const whileOpen = await readOf(store);
      await takeDown(store.productId);
      const afterRetake = await readOf(store);
      const again = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'lần gỡ thứ hai',
      );
      const third = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'lần ba',
      );

      expect(whileOpen.canAppeal).toBe(false);
      expect(whileOpen.appeals.map((item) => item.state)).toEqual(['CLOSED']);
      expect(afterRetake.canAppeal).toBe(true);
      expect(afterRetake.appeals.map((item) => item.state)).toEqual(['CLOSED']);
      expect(again.status).toBe(201);
      expect([third.status, code(third)]).toEqual([409, 'APPEAL_ALREADY_SENT']);

      const read = await readOf(store);
      expect(read.appeals.map((item) => [item.message, item.state])).toEqual([
        ['lần gỡ thứ hai', 'PENDING'],
        ['lần gỡ thứ nhất', 'CLOSED'],
      ]);
      expect(await rowsOf(store.productId)).toHaveLength(2);
    });

    // Chứng minh `SELECT ... FOR SHARE`: một giao dịch khác giữ khoá độc quyền hàng sản phẩm (như Admin đang khôi phục). Yêu cầu gửi kháng
    // nghị PHẢI chờ khoá đó, rồi đọc lại trạng thái MỚI — không bao giờ gắn kháng nghị vào lần gỡ vừa kết thúc.
    it('Admin đang khôi phục sản phẩm (giữ khoá hàng) ⇒ yêu cầu kháng nghị chờ, rồi nhận 409 APPEAL_NOT_ALLOWED, không để lại kháng nghị mồ côi', async () => {
      const store = await newTakenDownStore();
      let lockTaken!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (lockTaken = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      const restorer = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM products WHERE id = ${store.productId} FOR UPDATE`;
          lockTaken();
          await released;
          await tx.$executeRaw`UPDATE products SET status = 'DRAFT', taken_down_at = NULL, taken_down_by_id = NULL, taken_down_reason = NULL WHERE id = ${store.productId}`;
        },
        { timeout: 20_000 },
      );
      await locked;

      const pending = appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );
      const state = await Promise.race([
        pending.then(() => 'done'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('blocked'), 700),
        ),
      ]);
      release();
      await restorer;
      const res = await pending;

      expect(state).toBe('blocked');
      expect([res.status, code(res)]).toEqual([409, 'APPEAL_NOT_ALLOWED']);
      expect(await rowsOf(store.productId)).toHaveLength(0);
    });
  });

  describe('kết quả quyết định hiện cho chủ shop', () => {
    async function submit(store: Store) {
      const created = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );
      return (data(created) as { id: string }).id;
    }

    it('đã từ chối: thấy ghi chú, trạng thái REJECTED, KHÔNG biết Admin nào; sản phẩm vẫn bị gỡ và không kháng nghị lại được', async () => {
      const store = await newTakenDownStore();
      const appealId = await submit(store);
      const decided = await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'REJECT', note: 'Giấy tờ chưa hợp lệ' });
      expect(decided.status).toBe(200);

      const read = await readOf(store);
      const again = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'thử lại',
      );

      expect(read.canAppeal).toBe(false);
      expect(read.appeals[0]).toMatchObject({
        state: 'REJECTED',
        decisionNote: 'Giấy tờ chưa hợp lệ',
      });
      expect(read.appeals[0].decidedAt).not.toBeNull();
      const text = JSON.stringify(read);
      expect(text).not.toContain(adminId);
      expect(text).not.toMatch(/decidedBy|appellantId|targetId/);
      expect([again.status, code(again)]).toEqual([409, 'APPEAL_ALREADY_SENT']);
      expect((await productOf(store.productId)).status).toBe('TAKEN_DOWN');
    });

    it('đã chấp nhận: sản phẩm về NHÁP với ba cột gỡ được xoá, trạng thái ACCEPTED, hết quyền kháng nghị cho lần gỡ này', async () => {
      const store = await newTakenDownStore();
      const appealId = await submit(store);
      await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'ACCEPT' })
        .expect(200);

      const read = await readOf(store);
      const product = await productOf(store.productId);
      const again = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'thử lại',
      );

      expect(product).toMatchObject({
        status: 'DRAFT',
        takenDownAt: null,
        takenDownById: null,
        takenDownReason: null,
      });
      expect(read.appeals[0].state).toBe('ACCEPTED');
      expect(read.canAppeal).toBe(false);
      expect([again.status, code(again)]).toEqual([409, 'APPEAL_NOT_ALLOWED']);
    });

    it('được chấp nhận rồi sản phẩm bị gỡ LẠI: lần gỡ mới có quyền kháng nghị riêng, kháng nghị cũ vẫn là ACCEPTED', async () => {
      const store = await newTakenDownStore();
      const appealId = await submit(store);
      await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'ACCEPT' })
        .expect(200);

      await takeDown(store.productId);
      const read = await readOf(store);

      expect(read.canAppeal).toBe(true);
      expect(read.appeals.map((item) => item.state)).toEqual(['ACCEPTED']);
    });
  });

  describe('thông báo cho Admin', () => {
    it('mọi Admin ACTIVE nhận ADMIN_PRODUCT_APPEAL_PENDING chỉ mang id + tên sản phẩm — KHÔNG mang lời kháng nghị — và đúng hình dạng hợp đồng', async () => {
      const store = await newTakenDownStore();
      const message = `CANARY-APPEAL-${randomUUID()}`;
      const created = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        message,
      );
      const appealId = (data(created) as { id: string }).id;
      const product = await productOf(store.productId);

      const rows = await prisma.notification.findMany({
        where: { userId: adminId, type: 'ADMIN_PRODUCT_APPEAL_PENDING' },
      });

      const mine = rows.filter(
        (row) => (row.data as { appealId?: string }).appealId === appealId,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].data).toEqual({
        appealId,
        productId: store.productId,
        productName: product.name,
      });
      expect(JSON.stringify(mine[0].data)).not.toContain(message);
      expect(
        notificationContentSchema.safeParse({
          type: mine[0].type,
          data: mine[0].data,
        }).success,
      ).toBe(true);
    });

    it('kháng nghị bị từ chối vì đã gửi rồi ⇒ KHÔNG gửi thêm thông báo', async () => {
      const store = await newTakenDownStore();
      await appeal(store.agent, store.shopId, store.productId, 'lần một');
      const countFor = () =>
        prisma.notification.count({
          where: {
            userId: adminId,
            type: 'ADMIN_PRODUCT_APPEAL_PENDING',
            data: { path: ['productId'], equals: store.productId },
          },
        });
      const before = await countFor();

      await appeal(store.agent, store.shopId, store.productId, 'lần hai');

      expect(before).toBe(1);
      expect(await countFor()).toBe(1);
    });

    it('chủ shop nhận PRODUCT_APPEAL_DECIDED khi Admin quyết định — chỉ id, tên sản phẩm và kết quả, không ghi chú', async () => {
      const store = await newTakenDownStore();
      const created = await appeal(
        store.agent,
        store.shopId,
        store.productId,
        'xin xem xét',
      );
      const appealId = (data(created) as { id: string }).id;
      const note = `CANARY-NOTE-${randomUUID()}`;

      await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'REJECT', note })
        .expect(200);

      const rows = await prisma.notification.findMany({
        where: { userId: store.userId, type: 'PRODUCT_APPEAL_DECIDED' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].data).toEqual({
        appealId,
        productId: store.productId,
        productName: (await productOf(store.productId)).name,
        decision: 'REJECTED',
      });
      expect(JSON.stringify(rows[0].data)).not.toContain(note);
    });
  });

  describe('ràng buộc ngay ở DB (lưới cuối khi vòng qua Zod bằng SQL thô)', () => {
    it('hai kháng nghị cùng (đối tượng, mốc xử lý) ⇒ vi phạm UNIQUE, dù API đã chặn trước', async () => {
      const store = await newTakenDownStore();
      const product = await productOf(store.productId);
      const insert = () =>
        prisma.$executeRaw`INSERT INTO appeals (id, target_type, target_id, appellant_id, message, moderation_event_at)
          VALUES (${randomUUID()}, 'PRODUCT'::"AppealTargetType", ${store.productId}, ${store.userId}, 'x', ${product.takenDownAt})`;

      await insert();

      // Lỗi UNIQUE của SQL thô là mã 23505 (không phải P2002 của API model) kèm "already exists".
      await expect(insert()).rejects.toThrow(/23505.*already exists/);
      expect(await rowsOf(store.productId)).toHaveLength(1);
    });

    it('cùng sản phẩm, MỐC KHÁC (lần gỡ khác) ⇒ được phép', async () => {
      const store = await newTakenDownStore();
      const product = await productOf(store.productId);
      const later = new Date((product.takenDownAt as Date).getTime() + 1000);
      const insert = (at: Date) =>
        prisma.$executeRaw`INSERT INTO appeals (id, target_type, target_id, appellant_id, message, moderation_event_at)
          VALUES (${randomUUID()}, 'PRODUCT'::"AppealTargetType", ${store.productId}, ${store.userId}, 'x', ${at})`;

      await insert(product.takenDownAt as Date);
      await insert(later);

      expect(await rowsOf(store.productId)).toHaveLength(2);
    });
  });

  describe('log không bao giờ chứa lời kháng nghị', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const store = await newTakenDownStore();
      const retry = await newTakenDownStore();
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
        await store.agent
          .post(urlOf(store.shopId, store.productId))
          .send({ message: `${canary} lời kháng nghị thường` });
        await store.agent.get(urlOf(store.shopId, store.productId));
        // 2. sai dữ liệu: quá dài, chứa canary
        await store.agent.post(urlOf(store.shopId, store.productId)).send({
          message: `${canary}${'x'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1)}`,
        });
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả lời kháng nghị)
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { message: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await retry.agent
          .post(urlOf(retry.shopId, retry.productId))
          .send({ message: `${canary} lỗi Prisma` });
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(new Error('db down'));
        down = await retry.agent
          .post(urlOf(retry.shopId, retry.productId))
          .send({ message: `${canary} DB sập` });
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
      // ...nhưng không có lời kháng nghị.
      expect(logs).not.toContain(canary);
    });
  });

  describe('header và tài liệu API', () => {
    it('GET trả Cache-Control: no-store (dữ liệu riêng tư)', async () => {
      const store = await newTakenDownStore();

      const res = await list(store.agent, store.shopId, store.productId);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('Swagger khớp hành vi thật: GET khai báo đúng 200, POST khai báo đúng 201, và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('appeal').setVersion('0').build(),
      );
      const path = document.paths[
        '/api/v1/shops/{shopId}/products/{productId}/appeals'
      ] as Record<string, { responses: Record<string, unknown> }> | undefined;

      for (const [method, success] of [
        ['get', 200],
        ['post', 201],
      ] as const) {
        const operation = path?.[method];
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([
          success,
        ]);
        // 500 chỉ do test cố ý phá lúc ghi, không phải hành vi cần tài liệu.
        for (const status of [...observed[method]].filter((s) => s !== 500)) {
          expect([method, documented]).toEqual([
            method,
            expect.arrayContaining([status]),
          ]);
        }
      }
      expect([...observed.get].sort()).toEqual([200, 401, 403, 404]);
      expect([...observed.post].filter((s) => s !== 500).sort()).toEqual([
        201, 400, 401, 403, 404, 409,
      ]);
    });
  });
});
