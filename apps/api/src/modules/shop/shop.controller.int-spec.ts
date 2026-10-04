import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type ShopStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { shopSchema } from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho luồng nộp lại và khoá sửa shop (Week8.md
// 3C.5). Chứng minh điều unit test với mock không chứng minh được: ShopOwnerGuard thật chặn người lạ,
// PATCH có điều kiện chặn PENDING/SUSPENDED ở tầng DB (kể cả body rỗng), resubmit sửa field + chuyển
// trạng thái nguyên tử (thất bại thì field không bị sửa), 2 lần nộp lại đồng thời chỉ 1 bên thắng, và
// PATCH không bao giờ chen được vào sau khi shop đã sang PENDING. Chạy: `pnpm test:int`.
const TAG = 'it-shop-http-';
const PASSWORD = 'password123';

const fakeMail = createFakeMail();

describe('ShopController — nộp lại + khoá sửa (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  let owner: ReturnType<typeof newAgent>;
  let stranger: ReturnType<typeof newAgent>;
  let admin: ReturnType<typeof newAgent>;
  let ownerId: string;

  const body = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const errorBody = (res: { body: unknown }) =>
    res.body as {
      success: boolean;
      message: string;
      code?: string;
      details?: unknown;
    };

  async function registerAndLogin(suffix: string) {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`;
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}${suffix}` })
      .expect(201);
    // POST /shops cần email đã xác thực (EmailVerifiedGuard) — xác thực thẳng trong DB cho test.
    await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: row.id };
  }

  // Mỗi test dùng 1 shop riêng, dựng thẳng bằng prisma (đăng ký + đăng nhập 1 user cho MỖI shop quá chậm vì
  // bcrypt; DB không ràng buộc 1 user 1 shop — luật đó chỉ ở ShopService.createShop). Mặc định thuộc về
  // `owner` dùng chung; test cần "shop của tôi" (GET /shops/me) tự dựng user riêng.
  async function createShop(
    status: ShopStatus,
    statusReason: string | null = null,
    user: { agent: ReturnType<typeof newAgent>; userId: string } = {
      agent: owner,
      userId: ownerId,
    },
  ) {
    const shop = await prisma.shop.create({
      data: {
        ownerId: user.userId,
        name: `${TAG}shop`,
        slug: `${TAG}shop-${stamp.toString(36)}-${counter++}`,
        status,
        statusReason,
        // Mốc đổi trạng thái cũ đặt sẵn trong QUÁ KHỨ: `@default(now())` do engine Prisma sinh còn statusChangedAt
        // của lần chuyển là `new Date()` của Node — trên Windows 2 đồng hồ này có thể lệch vài ms nên so sánh
        // "mốc mới > mốc mặc định" sẽ chập chờn. Cho fixture cách xa 1 giờ thì so sánh luôn đúng.
        statusChangedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return { shopId: shop.id, agent: user.agent, userId: user.userId };
  }

  const shopOf = (shopId: string) =>
    prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const historyOf = (shopId: string) =>
    prisma.shopStatusHistory.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
    });

  const patchShop = (
    agent: ReturnType<typeof newAgent>,
    shopId: string,
    payload: Record<string, unknown>,
  ) => agent.patch(`/api/v1/shops/${shopId}`).send(payload);
  const resubmit = (
    agent: ReturnType<typeof newAgent>,
    shopId: string,
    payload: Record<string, unknown> = {},
  ) => agent.post(`/api/v1/shops/${shopId}/resubmit`).send(payload);

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

    const first = await registerAndLogin('owner');
    owner = first.agent;
    ownerId = first.userId;
    stranger = (await registerAndLogin('stranger')).agent;

    const adminEmail = `${TAG}${stamp}admin@test.local`;
    await seedAdmin(prisma, { email: adminEmail, password: PASSWORD });
    admin = newAgent();
    await admin
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /shops — mốc đầu của lịch sử', () => {
    it('tạo shop qua API: response parse được bằng shopSchema (có statusChangedAt) và có đúng 1 dòng null → PENDING, actor OWNER', async () => {
      const res = await owner
        .post('/api/v1/shops')
        .send({ name: `${TAG}Shop Đầu Tiên` })
        .expect(201);

      const shop = shopSchema.parse((body(res) as { shop: unknown }).shop);
      expect(shop.status).toBe('PENDING');
      expect(shop.statusChangedAt).toBe(shop.createdAt);
      const history = await historyOf(shop.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'OWNER',
        actorId: ownerId,
        note: null,
      });
    });
  });

  describe('PATCH /shops/:id — khoá sửa theo trạng thái', () => {
    it.each<ShopStatus>(['REJECTED', 'APPROVED'])(
      'shop %s sửa được: 200, response parse được bằng shopSchema, field đổi, status/lý do không đổi',
      async (status) => {
        const { shopId, agent } = await createShop(
          status,
          status === 'REJECTED' ? 'Thiếu giấy phép' : null,
        );

        const res = await patchShop(agent, shopId, {
          name: 'Tên đã sửa',
          description: 'Mô tả mới',
        }).expect(200);

        const shop = shopSchema.parse((body(res) as { shop: unknown }).shop);
        expect(shop).toMatchObject({
          name: 'Tên đã sửa',
          description: 'Mô tả mới',
          status,
        });
        const row = await shopOf(shopId);
        expect(row.statusReason).toBe(
          status === 'REJECTED' ? 'Thiếu giấy phép' : null,
        );
        // Sửa thông tin KHÔNG phải đổi trạng thái: không ghi history, statusChangedAt giữ nguyên.
        expect(await historyOf(shopId)).toHaveLength(0);
      },
    );

    it.each<ShopStatus>(['PENDING', 'SUSPENDED'])(
      'shop %s bị khoá sửa: 409 SHOP_EDIT_NOT_ALLOWED kèm details.status, shop không đổi gì',
      async (status) => {
        const { shopId, agent } = await createShop(
          status,
          status === 'SUSPENDED' ? 'Bán hàng cấm' : null,
        );
        const before = await shopOf(shopId);

        const res = await patchShop(agent, shopId, {
          name: 'Tên đã sửa',
        }).expect(409);

        expect(errorBody(res)).toMatchObject({
          success: false,
          code: 'SHOP_EDIT_NOT_ALLOWED',
          details: { status },
        });
        const after = await shopOf(shopId);
        expect(after.name).toBe(before.name);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      },
    );

    it('body rỗng {} — shop APPROVED ⇒ 200; shop PENDING ⇒ vẫn 409 (luật trạng thái không bị bỏ qua vì body rỗng)', async () => {
      const approved = await createShop('APPROVED');
      const pending = await createShop('PENDING');

      await patchShop(approved.agent, approved.shopId, {}).expect(200);
      await patchShop(pending.agent, pending.shopId, {}).expect(409);
    });

    it('status/slug gửi kèm bị bỏ qua: shop REJECTED không tự thành APPROVED, slug không đổi', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'x');
      const before = await shopOf(shopId);

      await patchShop(agent, shopId, {
        name: 'Tên mới',
        status: 'APPROVED',
        slug: 'slug-lach-luat',
      }).expect(200);

      const after = await shopOf(shopId);
      expect(after.status).toBe('REJECTED');
      expect(after.slug).toBe(before.slug);
      expect(after.name).toBe('Tên mới');
    });

    // Phải thử cả trên shop SỬA ĐƯỢC (APPROVED/REJECTED): trên PENDING/SUSPENDED câu UPDATE đằng nào cũng bị
    // điều kiện trạng thái chặn nên không chứng minh được điều kiện `ownerId` trong WHERE.
    it.each<ShopStatus>(['PENDING', 'APPROVED', 'REJECTED'])(
      'người khác (không phải chủ shop) sửa shop %s — 403, không lộ trạng thái shop, shop không đổi',
      async (status) => {
        const { shopId } = await createShop(status);
        const before = await shopOf(shopId);

        const res = await patchShop(stranger, shopId, {
          name: 'Chiếm shop',
        }).expect(403);

        expect(errorBody(res).details).toBeUndefined();
        const after = await shopOf(shopId);
        expect(after.name).toBe(before.name);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      },
    );

    it('chưa đăng nhập 401; shop không tồn tại 404', async () => {
      const { shopId } = await createShop('APPROVED');

      await request(app.getHttpServer())
        .patch(`/api/v1/shops/${shopId}`)
        .send({ name: 'x' })
        .expect(401);
      await patchShop(owner, '00000000-0000-4000-8000-000000000000', {
        name: 'x',
      }).expect(404);
    });
  });

  describe('POST /shops/:shopId/resubmit', () => {
    it('chủ shop REJECTED nộp lại (không sửa gì): 200, về PENDING, xoá lý do, statusChangedAt mới, ghi history OWNER', async () => {
      const { shopId, agent, userId } = await createShop(
        'REJECTED',
        'Thiếu giấy phép',
      );
      const before = await shopOf(shopId);

      const res = await resubmit(agent, shopId).expect(200);

      const shop = shopSchema.parse((body(res) as { shop: unknown }).shop);
      expect(shop.status).toBe('PENDING');
      expect(shop.statusReason).toBeNull();
      expect(new Date(shop.statusChangedAt).getTime()).toBeGreaterThan(
        before.statusChangedAt.getTime(),
      );
      const history = await historyOf(shopId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: 'REJECTED',
        toStatus: 'PENDING',
        actorType: 'OWNER',
        actorId: userId,
        note: null,
      });
      expect(history[0].createdAt.getTime()).toBe(
        new Date(shop.statusChangedAt).getTime(),
      );
    });

    it('nộp lại kèm chỉnh sửa: field được ghi CÙNG LÚC với việc chuyển PENDING', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'Thiếu mô tả');

      const res = await resubmit(agent, shopId, {
        name: 'Tên đã sửa',
        description: 'Mô tả đầy đủ',
      }).expect(200);

      const shop = shopSchema.parse((body(res) as { shop: unknown }).shop);
      expect(shop).toMatchObject({
        name: 'Tên đã sửa',
        description: 'Mô tả đầy đủ',
        status: 'PENDING',
      });
    });

    it('status/slug trong body bị bỏ qua — chủ shop KHÔNG BAO GIỜ tự APPROVED', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'x');
      const before = await shopOf(shopId);

      await resubmit(agent, shopId, {
        name: 'A',
        status: 'APPROVED',
        slug: 'slug-lach-luat',
      }).expect(200);

      const after = await shopOf(shopId);
      expect(after.status).toBe('PENDING');
      expect(after.slug).toBe(before.slug);
    });

    it.each<ShopStatus>(['PENDING', 'APPROVED', 'SUSPENDED'])(
      'shop %s không nộp lại được: 409 SHOP_INVALID_TRANSITION, và field kèm theo KHÔNG bị sửa (rollback)',
      async (status) => {
        const { shopId, agent } = await createShop(
          status,
          status === 'SUSPENDED' ? 'Bán hàng cấm' : null,
        );
        const before = await shopOf(shopId);

        const res = await resubmit(agent, shopId, {
          name: 'Tên không được lưu',
        }).expect(409);

        expect(errorBody(res)).toMatchObject({
          code: 'SHOP_INVALID_TRANSITION',
        });
        const after = await shopOf(shopId);
        expect(after.name).toBe(before.name);
        expect(after.status).toBe(status);
        expect(await historyOf(shopId)).toHaveLength(0);
      },
    );

    it('người khác (kể cả ADMIN không phải chủ shop) — 403, shop vẫn REJECTED nguyên vẹn', async () => {
      const { shopId } = await createShop('REJECTED', 'Thiếu giấy phép');

      await resubmit(stranger, shopId).expect(403);
      await resubmit(admin, shopId).expect(403);

      const shop = await shopOf(shopId);
      expect(shop.status).toBe('REJECTED');
      expect(shop.statusReason).toBe('Thiếu giấy phép');
      expect(await historyOf(shopId)).toHaveLength(0);
    });

    it('chưa đăng nhập 401; shop không tồn tại 404; body sai 400 (URL logo không hợp lệ) và shop không đổi', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'x');

      await request(app.getHttpServer())
        .post(`/api/v1/shops/${shopId}/resubmit`)
        .send({})
        .expect(401);
      await resubmit(owner, '00000000-0000-4000-8000-000000000000').expect(404);
      await resubmit(agent, shopId, { logoUrl: 'khong-phai-url' }).expect(400);

      expect((await shopOf(shopId)).status).toBe('REJECTED');
    });

    it('sau khi nộp lại shop đang PENDING: chủ shop không sửa được nữa (khoá sửa có hiệu lực ngay)', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'x');

      await resubmit(agent, shopId).expect(200);

      const res = await patchShop(agent, shopId, {
        name: 'Sửa sau khi nộp',
      }).expect(409);
      expect(errorBody(res)).toMatchObject({
        code: 'SHOP_EDIT_NOT_ALLOWED',
        details: { status: 'PENDING' },
      });
    });

    it('race: bấm "gửi duyệt lại" 2 lần đồng thời (2 tab) — đúng 1 lần 200, lần kia 409, đúng 1 dòng history', async () => {
      const { shopId, agent } = await createShop('REJECTED', 'x');

      const [a, b] = await Promise.all([
        resubmit(agent, shopId, { name: 'Lần 1' }),
        resubmit(agent, shopId, { name: 'Lần 2' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const history = await historyOf(shopId);
      expect(history).toHaveLength(1);
      const shop = await shopOf(shopId);
      expect(shop.status).toBe('PENDING');
      // Tên cuối cùng là của đúng lần THẮNG, không phải của lần thua (lần thua rollback cả field).
      const winner = a.status === 200 ? 'Lần 1' : 'Lần 2';
      expect(shop.name).toBe(winner);
    });

    it('race: PATCH ⇄ nộp lại (8 vòng) — PATCH không bao giờ chen được SAU khi shop đã sang PENDING (tên cuối luôn là của lần nộp lại)', async () => {
      for (let round = 0; round < 8; round++) {
        const { shopId, agent } = await createShop('REJECTED', 'x');

        const [patched, submitted] = await Promise.all([
          patchShop(agent, shopId, { name: 'Tên từ PATCH' }),
          resubmit(agent, shopId, { name: 'Tên từ nộp lại' }),
        ]);

        expect(submitted.status).toBe(200);
        expect([200, 409]).toContain(patched.status);
        const shop = await shopOf(shopId);
        expect(shop.status).toBe('PENDING');
        // Nếu PATCH ghi được SAU lần chuyển (kẽ hở đọc-rồi-ghi) thì tên cuối sẽ là 'Tên từ PATCH'.
        expect(shop.name).toBe('Tên từ nộp lại');
      }
    });
  });

  describe('vòng đời đầy đủ qua HTTP: từ chối → sửa & nộp lại → duyệt', () => {
    it('Admin từ chối ⇒ chủ shop thấy lý do, nộp lại ⇒ PENDING; Admin thấy lý do lần trước + số lần nộp lại sau 1 vòng (nền cho 3C.6)', async () => {
      const lifecycleOwner = await registerAndLogin('lifecycle');
      const { shopId, agent } = await createShop(
        'PENDING',
        null,
        lifecycleOwner,
      );

      await admin
        .patch(`/api/v1/admin/shops/${shopId}/status`)
        .send({ status: 'REJECTED', reason: 'Thiếu giấy phép' })
        .expect(200);
      const mine = await agent.get('/api/v1/shops/me').expect(200);
      expect(
        shopSchema.parse((body(mine) as { shop: unknown }).shop),
      ).toMatchObject({ status: 'REJECTED', statusReason: 'Thiếu giấy phép' });

      await resubmit(agent, shopId, {
        description: 'Đã bổ sung giấy phép',
      }).expect(200);
      await admin
        .patch(`/api/v1/admin/shops/${shopId}/status`)
        .send({ status: 'APPROVED' })
        .expect(200);

      const history = await historyOf(shopId);
      expect(history.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual([
        'PENDING>REJECTED',
        'REJECTED>PENDING',
        'PENDING>APPROVED',
      ]);
      expect(history.map((h) => h.actorType)).toEqual([
        'ADMIN',
        'OWNER',
        'ADMIN',
      ]);
      expect(history[0].note).toBe('Thiếu giấy phép');
    });
  });
});
