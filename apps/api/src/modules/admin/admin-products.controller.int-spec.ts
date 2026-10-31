import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  notificationContentSchema,
  PRODUCT_TAKEDOWN_REASON_MAX_LENGTH,
  productModerationResponseSchema,
} from '@ecommerce/types';
import { seedAdmin } from '../../../prisma/seed-admin';
import { AppModule } from '../../app.module';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createOrderWithItem,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho gỡ / khôi phục sản phẩm vi phạm của Admin (Week11.md 5.7, D5). Chứng minh
// điều unit test với mock không chứng minh được: chuyển trạng thái là UPDATE có điều kiện (hai Admin cùng gỡ ⇒ đúng một bên thắng, một
// dòng nhật ký, một thông báo), nhật ký ghi CÙNG giao dịch, chủ shop bị chặn MỌI đường ghi (sửa, đổi trạng thái, lưu trữ) khi sản phẩm
// đang bị gỡ nhưng vẫn đọc được lý do, sản phẩm biến khỏi MỌI nơi đọc công khai (chi tiết, danh sách, tìm kiếm, trang shop, giỏ, wishlist),
// đơn đã đặt không bị ảnh hưởng, và CHECK ở DB giữ quan hệ trạng thái ↔ ba cột gỡ. Chạy: `pnpm test:int`.
const TAG = 'it-admin-products-';
const PASSWORD = 'password123';
const NUL = String.fromCharCode(0);
const REASON = 'Bán hàng cấm: dao bấm tự động lò xo';
const fakeMail = createFakeMail();

describe('Gỡ / khôi phục sản phẩm của Admin (HTTP thật)', () => {
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

  const observed = {
    takeDown: new Set<number>(),
    restore: new Set<number>(),
  };

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
    shopSlug: string;
    productId: string;
    productSlug: string;
    productName: string;
    variantId: string;
    sku: string;
  }

  async function newStore(
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED',
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
        status: 'APPROVED',
      },
      select: { id: true, slug: true },
    });
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: category.id,
        name: `${TAG}product${n}`,
        slug: `${TAG}product-${stamp.toString(36)}-${n}`,
        status,
        minPrice: 100000,
        maxPrice: 100000,
      },
      select: { id: true, slug: true, name: true },
    });
    const variant = await createVariant(
      prisma,
      { shopId: shop.id, productId: product.id },
      { stock: 10 },
    );
    const { sku } = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { sku: true },
    });
    return {
      owner,
      shopId: shop.id,
      shopSlug: shop.slug,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      variantId: variant.id,
      sku,
    };
  }

  const takeDownUrl = (id: string) => `/api/v1/admin/products/${id}/take-down`;
  const restoreUrl = (id: string) => `/api/v1/admin/products/${id}/restore`;
  async function takeDown(
    agent: Agent,
    id: string,
    body: unknown = { reason: REASON },
  ) {
    const res = await agent.post(takeDownUrl(id)).send(body as object);
    observed.takeDown.add(res.status);
    return res;
  }
  async function restore(
    agent: Agent,
    id: string,
    body: unknown = { reason: REASON },
  ) {
    const res = await agent.post(restoreUrl(id)).send(body as object);
    observed.restore.add(res.status);
    return res;
  }

  const productRow = (id: string) =>
    prisma.product.findUniqueOrThrow({ where: { id } });
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
    // Thông báo gửi cả cho Admin THẬT của DB dev (không mang tiền tố test): dọn phần của lượt này.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401; người dùng thường và chủ shop 403; sản phẩm không bị đụng tới', async () => {
      const store = await newStore();
      const stranger = await newAccount();

      const anon = await Promise.all([
        anonymous.post(takeDownUrl(store.productId)).send({ reason: REASON }),
        anonymous.post(restoreUrl(store.productId)).send({ reason: REASON }),
      ]);
      const forbidden = await Promise.all(
        [stranger, store.owner].flatMap((who) => [
          who.agent.post(takeDownUrl(store.productId)).send({ reason: REASON }),
          who.agent.post(restoreUrl(store.productId)).send({ reason: REASON }),
        ]),
      );

      expect(anon.map((r) => r.status)).toEqual([401, 401]);
      expect(forbidden.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect((await productRow(store.productId)).status).toBe('PUBLISHED');
    });

    it.each([
      ['thiếu lý do', {}],
      ['lý do rỗng', { reason: '' }],
      ['lý do toàn khoảng trắng', { reason: '   ' }],
      [
        'lý do quá 500 ký tự',
        { reason: 'a'.repeat(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH + 1) },
      ],
      ['lý do có ký tự điều khiển', { reason: `a${NUL}b` }],
    ])('%s ⇒ 400 và sản phẩm không đổi', async (_name, body) => {
      const store = await newStore();

      const res = await takeDown(admin, store.productId, body);

      expect(res.status).toBe(400);
      expect((await productRow(store.productId)).status).toBe('PUBLISHED');
    });

    it('sản phẩm không tồn tại hoặc id sai dạng ⇒ cùng một 404 PRODUCT_NOT_FOUND (cả hai route)', async () => {
      const missing = await takeDown(admin, randomUUID());
      const malformed = await takeDown(admin, 'not-a-uuid');
      // Id chứa NUL: Postgres không nhận, nếu lọt xuống DB sẽ thành 500 thay vì 404.
      const withNul = await takeDown(admin, encodeURIComponent(`a${NUL}b`));
      const restoreMissing = await restore(admin, randomUUID());
      const restoreWithNul = await restore(
        admin,
        encodeURIComponent(`a${NUL}b`),
      );

      expect([missing.status, code(missing)]).toEqual([
        404,
        'PRODUCT_NOT_FOUND',
      ]);
      expect(malformed.body).toEqual(missing.body);
      expect(withNul.body).toEqual(missing.body);
      expect([restoreMissing.status, code(restoreMissing)]).toEqual([
        404,
        'PRODUCT_NOT_FOUND',
      ]);
      expect(restoreWithNul.body).toEqual(restoreMissing.body);
    });
  });

  describe('gỡ sản phẩm', () => {
    it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
      'từ %s: 200, ba cột gỡ cùng có giá trị, trả đúng hình dạng hợp đồng, Cache-Control no-store',
      async (from) => {
        const store = await newStore(from);

        const res = await takeDown(admin, store.productId);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('no-store');
        const parsed = productModerationResponseSchema.parse(dataOf(res));
        expect(parsed.product).toEqual({
          id: store.productId,
          status: 'TAKEN_DOWN',
          takenDownAt: expect.any(String) as string,
        });
        const row = await productRow(store.productId);
        expect(row.status).toBe('TAKEN_DOWN');
        expect(row.takenDownById).toBe(adminId);
        expect(row.takenDownReason).toBe(REASON);
        expect(row.takenDownAt?.toISOString()).toBe(parsed.product.takenDownAt);
      },
    );

    it('response không lộ lý do, tên sản phẩm hay shop (chỉ id, trạng thái, mốc gỡ)', async () => {
      const store = await newStore();

      const res = await takeDown(admin, store.productId);

      expect(
        Object.keys((dataOf(res) as { product: object }).product).sort(),
      ).toEqual(['id', 'status', 'takenDownAt']);
      expect(JSON.stringify(res.body)).not.toContain(REASON);
    });

    it('ghi MỘT dòng nhật ký TAKE_DOWN_PRODUCT lên sản phẩm: người gỡ, lý do, meta chỉ có shopId', async () => {
      const store = await newStore();

      await takeDown(admin, store.productId);

      const rows = await auditRows('TAKE_DOWN_PRODUCT', store.productId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: adminId,
        targetType: 'PRODUCT',
        reason: REASON,
        meta: { shopId: store.shopId },
      });
    });

    it('báo ĐÚNG chủ shop một thông báo PRODUCT_TAKEN_DOWN (id, tên, lý do); không ai khác nhận gì', async () => {
      const store = await newStore();
      const stranger = await newAccount();

      await takeDown(admin, store.productId);

      const owned = await notificationsOf(
        store.owner.userId,
        'PRODUCT_TAKEN_DOWN',
      );
      expect(owned).toHaveLength(1);
      const content = notificationContentSchema.parse({
        type: owned[0].type,
        data: owned[0].data,
      });
      expect(content).toEqual({
        type: 'PRODUCT_TAKEN_DOWN',
        data: {
          productId: store.productId,
          productName: store.productName,
          reason: REASON,
        },
      });
      expect(
        await notificationsOf(stranger.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(0);
      expect(await notificationsOf(adminId, 'PRODUCT_TAKEN_DOWN')).toHaveLength(
        0,
      );
    });

    it('đã bị gỡ ⇒ 409 PRODUCT_ALREADY_TAKEN_DOWN; lý do và mốc gỡ GIỮ NGUYÊN, không dòng nhật ký / thông báo thứ hai', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);
      const before = await productRow(store.productId);

      const again = await takeDown(admin2, store.productId, {
        reason: 'Lý do khác',
      });

      expect([again.status, code(again)]).toEqual([
        409,
        'PRODUCT_ALREADY_TAKEN_DOWN',
      ]);
      const after = await productRow(store.productId);
      expect(after.takenDownReason).toBe(REASON);
      expect(after.takenDownAt).toEqual(before.takenDownAt);
      expect(after.takenDownById).toBe(adminId);
      expect(
        await auditRows('TAKE_DOWN_PRODUCT', store.productId),
      ).toHaveLength(1);
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(1);
    });

    it('ĐUA: hai Admin cùng gỡ một sản phẩm ⇒ đúng một bên 200, một bên 409; một dòng nhật ký, một thông báo', async () => {
      const store = await newStore();

      const responses = await Promise.all([
        takeDown(admin, store.productId, { reason: 'Admin một' }),
        takeDown(admin2, store.productId, { reason: 'Admin hai' }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = responses.find((r) => r.status === 409);
      expect(code(loser as { body: unknown })).toBe(
        'PRODUCT_ALREADY_TAKEN_DOWN',
      );
      expect(
        await auditRows('TAKE_DOWN_PRODUCT', store.productId),
      ).toHaveLength(1);
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(1);
      // Lý do trên sản phẩm là của bên THẮNG, khớp dòng nhật ký.
      const [audit] = await auditRows('TAKE_DOWN_PRODUCT', store.productId);
      expect((await productRow(store.productId)).takenDownReason).toBe(
        audit.reason,
      );
    });

    it('nhật ký lỗi ⇒ rollback cả việc gỡ (sản phẩm vẫn đang bán) và không báo chủ shop', async () => {
      const store = await newStore();
      jest
        .spyOn(app.get(AdminAuditService), 'record')
        .mockRejectedValue(new Error('audit down'));

      const res = await takeDown(admin, store.productId);

      expect(res.status).toBe(500);
      const row = await productRow(store.productId);
      expect(row.status).toBe('PUBLISHED');
      expect(row.takenDownAt).toBeNull();
      expect(row.takenDownReason).toBeNull();
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(0);
    });
  });

  describe('khôi phục sản phẩm', () => {
    it('TAKEN_DOWN → NHÁP: xoá cả ba cột gỡ, ghi nhật ký RESTORE_PRODUCT, KHÔNG báo chủ shop', async () => {
      const store = await newStore('PUBLISHED');
      await takeDown(admin, store.productId);
      const notificationsBefore = await notificationsOf(
        store.owner.userId,
        'PRODUCT_TAKEN_DOWN',
      );

      const res = await restore(admin2, store.productId, {
        reason: 'Đã xét lại, sản phẩm không vi phạm',
      });

      expect(res.status).toBe(200);
      expect(productModerationResponseSchema.parse(dataOf(res))).toEqual({
        product: { id: store.productId, status: 'DRAFT', takenDownAt: null },
      });
      const row = await productRow(store.productId);
      expect(row).toMatchObject({
        status: 'DRAFT',
        takenDownAt: null,
        takenDownById: null,
        takenDownReason: null,
      });
      const rows = await auditRows('RESTORE_PRODUCT', store.productId);
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('Đã xét lại, sản phẩm không vi phạm');
      // Không thêm thông báo nào.
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(notificationsBefore.length);
    });

    it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const)(
      'sản phẩm đang %s (không bị gỡ) ⇒ 409 PRODUCT_NOT_TAKEN_DOWN, không đổi gì, không nhật ký',
      async (status) => {
        const store = await newStore(status);

        const res = await restore(admin, store.productId);

        expect([res.status, code(res)]).toEqual([
          409,
          'PRODUCT_NOT_TAKEN_DOWN',
        ]);
        expect((await productRow(store.productId)).status).toBe(status);
        expect(
          await auditRows('RESTORE_PRODUCT', store.productId),
        ).toHaveLength(0);
      },
    );

    it('ĐUA: hai Admin cùng khôi phục ⇒ đúng một bên 200, một bên 409; một dòng nhật ký', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);

      const responses = await Promise.all([
        restore(admin, store.productId),
        restore(admin2, store.productId),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await auditRows('RESTORE_PRODUCT', store.productId)).toHaveLength(
        1,
      );
    });

    it('gỡ lại sau khi khôi phục là một lần gỡ MỚI: mốc gỡ mới, lý do mới, thêm một thông báo', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId, { reason: 'Lần một' });
      const first = (await productRow(store.productId)).takenDownAt;
      await restore(admin, store.productId);

      await takeDown(admin, store.productId, { reason: 'Lần hai' });

      const row = await productRow(store.productId);
      expect(row.takenDownReason).toBe('Lần hai');
      expect(row.takenDownAt?.getTime()).toBeGreaterThan(first?.getTime() ?? 0);
      expect(
        await auditRows('TAKE_DOWN_PRODUCT', store.productId),
      ).toHaveLength(2);
      expect(
        await notificationsOf(store.owner.userId, 'PRODUCT_TAKEN_DOWN'),
      ).toHaveLength(2);
    });
  });

  describe('chủ shop khi sản phẩm bị gỡ', () => {
    it('đọc được sản phẩm của mình kèm trạng thái và LÝ DO (chi tiết + danh sách shop); lý do không lộ ở nơi khác', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);

      const detail = await store.owner.agent.get(
        `/api/v1/products/${store.productId}`,
      );
      const list = await store.owner.agent.get(
        `/api/v1/shops/${store.shopId}/products`,
      );

      expect(detail.status).toBe(200);
      const product = (
        dataOf(detail) as {
          product: { status: string; takenDownReason: string | null };
        }
      ).product;
      expect(product.status).toBe('TAKEN_DOWN');
      expect(product.takenDownReason).toBe(REASON);
      const row = (
        dataOf(list) as {
          products: { id: string; status: string; takenDownReason: string }[];
        }
      ).products.find((p) => p.id === store.productId);
      expect(row).toMatchObject({
        status: 'TAKEN_DOWN',
        takenDownReason: REASON,
      });
    });

    it('PATCH đổi tên / đổi trạng thái sang PUBLISHED / gửi biến thể mới ⇒ 409 PRODUCT_TAKEN_DOWN và KHÔNG ghi gì', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);
      const before = await productRow(store.productId);

      const attempts = await Promise.all([
        store.owner.agent
          .patch(`/api/v1/products/${store.productId}`)
          .send({ name: 'Tên mới sau khi bị gỡ' }),
        store.owner.agent
          .patch(`/api/v1/products/${store.productId}`)
          .send({ status: 'PUBLISHED' }),
        store.owner.agent.patch(`/api/v1/products/${store.productId}`).send({
          attributes: [],
          variants: [
            {
              sku: store.sku,
              price: 999999,
              stock: 99,
              images: [],
              attributeValues: [],
            },
          ],
        }),
      ]);

      for (const res of attempts) {
        expect([res.status, code(res)]).toEqual([409, 'PRODUCT_TAKEN_DOWN']);
      }
      const after = await productRow(store.productId);
      expect(after).toMatchObject({
        name: before.name,
        status: 'TAKEN_DOWN',
        takenDownReason: REASON,
      });
      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: store.variantId },
        select: { price: true, stock: true },
      });
      expect(Number(variant.price)).toBe(100000);
      expect(variant.stock).toBe(10);
    });

    it('DELETE (lưu trữ) ⇒ 409 PRODUCT_TAKEN_DOWN, sản phẩm vẫn TAKEN_DOWN', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);

      const res = await store.owner.agent.delete(
        `/api/v1/products/${store.productId}`,
      );

      expect([res.status, code(res)]).toEqual([409, 'PRODUCT_TAKEN_DOWN']);
      expect((await productRow(store.productId)).status).toBe('TAKEN_DOWN');
    });

    it('không tự đặt được status=TAKEN_DOWN qua PATCH (400) và không gỡ được sản phẩm của chính mình qua route Admin (403)', async () => {
      const store = await newStore();

      const patch = await store.owner.agent
        .patch(`/api/v1/products/${store.productId}`)
        .send({ status: 'TAKEN_DOWN' });
      const adminRoute = await store.owner.agent
        .post(takeDownUrl(store.productId))
        .send({ reason: REASON });

      expect(patch.status).toBe(400);
      expect(adminRoute.status).toBe(403);
      expect((await productRow(store.productId)).status).toBe('PUBLISHED');
    });

    it('chủ shop KHÁC không đụng được sản phẩm bị gỡ (403 ở guard) và không đọc được nó (404)', async () => {
      const store = await newStore();
      const other = await newStore();
      await takeDown(admin, store.productId);

      const patch = await other.owner.agent
        .patch(`/api/v1/products/${store.productId}`)
        .send({ name: 'x' });
      const read = await other.owner.agent.get(
        `/api/v1/products/${store.productId}`,
      );

      expect(patch.status).toBe(403);
      expect(read.status).toBe(404);
    });

    it('SAU khi Admin khôi phục: chủ shop sửa được và xuất bản lại được (qua NHÁP)', async () => {
      const store = await newStore();
      await takeDown(admin, store.productId);
      await restore(admin, store.productId);

      const edit = await store.owner.agent
        .patch(`/api/v1/products/${store.productId}`)
        .send({ name: 'Tên đã chỉnh sau khi khôi phục', status: 'PUBLISHED' });

      expect(edit.status).toBe(200);
      expect(await productRow(store.productId)).toMatchObject({
        name: 'Tên đã chỉnh sau khi khôi phục',
        status: 'PUBLISHED',
        takenDownAt: null,
        takenDownReason: null,
      });
    });

    it('ĐUA: chủ shop sửa đúng lúc Admin gỡ ⇒ không bao giờ ra trạng thái nửa vời (hoặc sửa xong rồi bị gỡ, hoặc bị chặn 409)', async () => {
      const store = await newStore();

      const [patch, down] = await Promise.all([
        store.owner.agent
          .patch(`/api/v1/products/${store.productId}`)
          .send({ name: 'Tên đua nhau', status: 'ARCHIVED' }),
        takeDown(admin, store.productId),
      ]);

      expect(down.status).toBe(200);
      expect([200, 409]).toContain(patch.status);
      const row = await productRow(store.productId);
      // Dù thứ tự nào, cuối cùng sản phẩm là TAKEN_DOWN với đủ ba cột (CHECK ở DB cũng đảm bảo) và lý do của Admin.
      expect(row.status).toBe('TAKEN_DOWN');
      expect(row.takenDownReason).toBe(REASON);
      expect(row.takenDownById).toBe(adminId);
    });
  });

  describe('biến khỏi mọi nơi đọc công khai', () => {
    it('chi tiết công khai: khách và người dùng khác nhận 404 (như không tồn tại), cả theo id lẫn theo slug', async () => {
      const store = await newStore();
      const stranger = await newAccount();
      const before = await anonymous.get(
        `/api/v1/products/${store.productSlug}`,
      );
      expect(before.status).toBe(200);

      await takeDown(admin, store.productId);

      const responses = await Promise.all([
        anonymous.get(`/api/v1/products/${store.productSlug}`),
        anonymous.get(`/api/v1/products/${store.productId}`),
        stranger.agent.get(`/api/v1/products/${store.productSlug}`),
      ]);
      expect(responses.map((r) => r.status)).toEqual([404, 404, 404]);
      const missing = await anonymous.get(`/api/v1/products/${randomUUID()}`);
      for (const res of responses) expect(res.body).toEqual(missing.body);
    });

    it('danh sách công khai, tìm kiếm và danh sách theo shop không còn trả sản phẩm', async () => {
      const store = await newStore();
      const publicBefore = await anonymous.get(
        `/api/v1/products?shopSlug=${store.shopSlug}`,
      );
      const idsOf = (res: { body: unknown }) =>
        (dataOf(res) as { items: { id: string }[] }).items.map(
          (item) => item.id,
        );
      expect(idsOf(publicBefore)).toContain(store.productId);

      await takeDown(admin, store.productId);

      const byShop = await anonymous.get(
        `/api/v1/products?shopSlug=${store.shopSlug}`,
      );
      const bySearch = await anonymous.get(
        `/api/v1/products?q=${encodeURIComponent(store.productName)}`,
      );
      const all = await anonymous.get('/api/v1/products?limit=50');
      expect(idsOf(byShop)).not.toContain(store.productId);
      expect(idsOf(bySearch)).not.toContain(store.productId);
      expect(idsOf(all)).not.toContain(store.productId);
    });

    it('giỏ hàng: không thêm được (409 CART_ITEM_UNAVAILABLE); dòng ĐÃ có trong giỏ hiện isAvailable=false và không cộng vào tổng', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      await buyer.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: store.variantId, quantity: 1 })
        .expect(201);
      await takeDown(admin, store.productId);

      const add = await buyer.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: store.variantId, quantity: 1 });
      const cart = await buyer.agent.get('/api/v1/cart');

      expect([add.status, code(add)]).toEqual([409, 'CART_ITEM_UNAVAILABLE']);
      const view = (
        dataOf(cart) as {
          cart: {
            shops: { items: { isAvailable: boolean }[] }[];
            subtotal: string;
          };
        }
      ).cart;
      const items = view.shops.flatMap((shop) => shop.items);
      expect(items).toHaveLength(1);
      expect(items[0].isAvailable).toBe(false);
      expect(Number(view.subtotal)).toBe(0);
    });

    it('wishlist: sản phẩm đã thích hiện isAvailable=false (không biến mất, người dùng còn bỏ thích được)', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      await buyer.agent.post(`/api/v1/wishlist/${store.productId}`).expect(201);
      await takeDown(admin, store.productId);

      const list = await buyer.agent.get('/api/v1/wishlist');
      const remove = await buyer.agent.delete(
        `/api/v1/wishlist/${store.productId}`,
      );

      const item = (
        dataOf(list) as { items: { id: string; isAvailable: boolean }[] }
      ).items.find((entry) => entry.id === store.productId);
      expect(item?.isAvailable).toBe(false);
      expect(remove.status).toBe(200);
    });

    it('đơn ĐÃ đặt không bị ảnh hưởng: người mua vẫn xem được chi tiết đơn với dòng hàng cũ', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyer.userId,
        shopId: store.shopId,
        variantId: store.variantId,
        status: 'COMPLETED',
      });
      await takeDown(admin, store.productId);

      const detail = await buyer.agent.get(`/api/v1/orders/${orderId}`);

      expect(detail.status).toBe(200);
      const order = dataOf(detail) as { status: string; items: unknown[] };
      expect(order.status).toBe('COMPLETED');
      expect(order.items).toHaveLength(1);
    });

    it('đánh giá và điểm của sản phẩm không đổi khi gỡ (chỉ khôi phục lại là hiển thị tiếp)', async () => {
      const store = await newStore();
      const buyer = await newAccount();
      const { orderId } = await createOrderWithItem(prisma, {
        userId: buyer.userId,
        shopId: store.shopId,
        variantId: store.variantId,
        status: 'COMPLETED',
      });
      await buyer.agent
        .post('/api/v1/reviews')
        .send({ orderId, productId: store.productId, rating: 4 })
        .expect(201);
      const before = await productRow(store.productId);

      await takeDown(admin, store.productId);
      await restore(admin, store.productId);

      const after = await productRow(store.productId);
      expect(after.avgRating).toBe(before.avgRating);
      expect(after.reviewCount).toBe(before.reviewCount);
    });
  });

  describe('CHECK ở DB giữ quan hệ trạng thái ↔ ba cột gỡ (lưới cuối cho mọi đường vòng qua service)', () => {
    const setRaw = (productId: string, fragment: string) =>
      prisma.$executeRawUnsafe(
        `UPDATE products SET ${fragment} WHERE id = '${productId}'`,
      );

    it.each([
      ['TAKEN_DOWN mà thiếu cả ba cột', `status = 'TAKEN_DOWN'`],
      [
        'TAKEN_DOWN mà thiếu mốc gỡ',
        `status = 'TAKEN_DOWN', taken_down_by_id = 'admin-1', taken_down_reason = 'ok'`,
      ],
      [
        'TAKEN_DOWN mà thiếu người gỡ',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_reason = 'ok'`,
      ],
      [
        'TAKEN_DOWN với người gỡ rỗng',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = '', taken_down_reason = 'ok'`,
      ],
      [
        'TAKEN_DOWN với người gỡ dài quá 64 ký tự',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = '${'a'.repeat(65)}', taken_down_reason = 'ok'`,
      ],
      [
        'TAKEN_DOWN mà thiếu lý do',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = 'admin-1'`,
      ],
      [
        'TAKEN_DOWN với lý do rỗng',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = 'admin-1', taken_down_reason = ''`,
      ],
      [
        'TAKEN_DOWN với lý do 501 ký tự',
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = 'admin-1', taken_down_reason = '${'a'.repeat(501)}'`,
      ],
      [
        'còn sót cột gỡ khi trạng thái KHÔNG phải TAKEN_DOWN',
        `taken_down_reason = 'còn sót'`,
      ],
    ])('%s ⇒ DB từ chối', async (_name, fragment) => {
      const store = await newStore();

      await expect(setRaw(store.productId, fragment)).rejects.toThrow();

      expect((await productRow(store.productId)).status).toBe('PUBLISHED');
    });

    it('trạng thái hợp lệ đủ ba cột được DB chấp nhận (đối chứng: CHECK không chặn nhầm)', async () => {
      const store = await newStore();

      await setRaw(
        store.productId,
        `status = 'TAKEN_DOWN', taken_down_at = now(), taken_down_by_id = 'admin-1', taken_down_reason = 'ok'`,
      );

      expect((await productRow(store.productId)).status).toBe('TAKEN_DOWN');
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: cả hai route khai báo đúng 200 và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('admin-products')
          .setVersion('0')
          .build(),
      );
      type Operations = Record<string, { responses: Record<string, unknown> }>;
      const takeDownPath = document.paths[
        '/api/v1/admin/products/{id}/take-down'
      ] as Operations | undefined;
      const restorePath = document.paths[
        '/api/v1/admin/products/{id}/restore'
      ] as Operations | undefined;

      for (const [operation, observedSet] of [
        [takeDownPath?.post, observed.takeDown],
        [restorePath?.post, observed.restore],
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
