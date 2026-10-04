import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type ShopStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  adminShopListResponseSchema,
  adminShopSchema,
  shopSchema,
  type AdminShop,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  addCartItem,
  cleanupByTag,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho module admin (Week8.md 2.10).
// Chứng minh điều unit test với mock không chứng minh được: RolesGuard thật chặn user thường (403) và
// khách (401); tài khoản ADMIN do chính `seedAdmin` tạo đăng nhập được; cạnh chuyển trạng thái sai ⇒
// 409; 2 Admin đổi cùng 1 shop đồng thời ⇒ đúng 1 bên thắng; và — quan trọng nhất — khoá/mở khoá
// shop có hiệu lực ngay lên trang công khai và giỏ hàng mà KHÔNG sửa query nào (cơ chế sẵn có).
// Chạy: `pnpm test:int`.
const TAG = 'it-admin-';
const PASSWORD = 'password123';

const fakeMail = createFakeMail();

describe('AdminController (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const newAgent = () => request.agent(app.getHttpServer());
  let admin: ReturnType<typeof newAgent>;
  let user: ReturnType<typeof newAgent>;
  let seller: ReturnType<typeof newAgent>;
  let buyer: ReturnType<typeof newAgent>;
  let userId: string;
  let sellerId: string;
  let buyerId: string;

  const body = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const errorBody = (res: { body: unknown }) =>
    res.body as { success: boolean; message: string; code?: string };

  async function login(agent: ReturnType<typeof newAgent>, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function registerAndLogin(suffix: string) {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`;
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}${suffix}` })
      .expect(201);
    await login(agent, email);
    const row = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: row.id, email };
  }

  // Shop do `ownerId` sở hữu, có 1 sản phẩm PUBLISHED + 1 variant còn hàng, ở trạng thái `status`.
  async function createShop(ownerId: string, status: ShopStatus) {
    const base = await createShopWithProduct(prisma, TAG);
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { ownerId, status },
    });
    const variant = await createVariant(prisma, base, { stock: 10 });
    return { ...base, variantId: variant.id };
  }

  // `payload` cố ý để lỏng (status/reason tuỳ chọn) để gửi được cả body sai cho các test 400.
  const patchStatus = (
    shopId: string,
    payload: { status?: string; reason?: string },
    agent = admin,
  ) => agent.patch(`/api/v1/admin/shops/${shopId}/status`).send(payload);

  const statusOf = async (shopId: string) =>
    prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { status: true, statusReason: true },
    });

  // Dev DB có thể có nhiều shop PENDING cũ (xếp trước shop mới) — duyệt qua các trang tới khi thấy.
  async function findInList(status: ShopStatus, shopId: string) {
    for (let page = 1; page <= 20; page++) {
      const res = await admin
        .get(`/api/v1/admin/shops?status=${status}&limit=50&page=${page}`)
        .expect(200);
      const data = adminShopListResponseSchema.parse(body(res));
      const found = data.items.find((item) => item.id === shopId);
      if (found) return found;
      if (page * 50 >= data.total) return undefined;
    }
    return undefined;
  }

  const publicProductIds = async (shopId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/products?shopId=${shopId}`)
      .expect(200);
    return (body(res) as { items: { id: string }[] }).items.map((i) => i.id);
  };

  const cartAvailability = async (variantId: string) => {
    const res = await buyer.get('/api/v1/cart').expect(200);
    const lines = (
      body(res) as {
        cart: {
          shops: {
            items: { productVariantId: string; isAvailable: boolean }[];
          }[];
        };
      }
    ).cart.shops.flatMap((shop) => shop.items);
    return lines.find((line) => line.productVariantId === variantId)
      ?.isAvailable;
  };

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    // MailProvider GIẢ: đăng ký tài khoản gửi email xác thực — không bao giờ gọi Resend thật.
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

    // ADMIN tạo đúng bằng hàm của seed (không tự dựng bằng prisma) — chứng minh tài khoản seed đăng
    // nhập được bằng mật khẩu đã khai.
    const adminEmail = `${TAG}${stamp}admin@test.local`;
    expect(
      await seedAdmin(prisma, { email: adminEmail, password: PASSWORD }),
    ).toBe('created');
    admin = newAgent();
    await login(admin, adminEmail);

    const plain = await registerAndLogin('user');
    const owner = await registerAndLogin('seller');
    const shopper = await registerAndLogin('buyer');
    user = plain.agent;
    userId = plain.userId;
    seller = owner.agent;
    sellerId = owner.userId;
    buyer = shopper.agent;
    buyerId = shopper.userId;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền truy cập (RolesGuard thật)', () => {
    let shopId: string;

    beforeAll(async () => {
      shopId = (await createShop(sellerId, 'PENDING')).shopId;
    });

    it('chưa đăng nhập — 401 cả 2 route', async () => {
      const anonymous = request(app.getHttpServer());
      await anonymous.get('/api/v1/admin/shops').expect(401);
      await anonymous
        .patch(`/api/v1/admin/shops/${shopId}/status`)
        .send({ status: 'APPROVED' })
        .expect(401);
    });

    it('user thường — 403 cả 2 route, shop không bị đổi', async () => {
      await user.get('/api/v1/admin/shops').expect(403);
      await patchStatus(shopId, { status: 'APPROVED' }, user).expect(403);

      expect((await statusOf(shopId)).status).toBe('PENDING');
    });

    it('chủ shop (Seller) cũng KHÔNG tự duyệt/khoá được shop của mình — 403', async () => {
      await seller.get('/api/v1/admin/shops').expect(403);
      await patchStatus(shopId, { status: 'APPROVED' }, seller).expect(403);

      expect((await statusOf(shopId)).status).toBe('PENDING');
    });

    it('ADMIN — 200', async () => {
      await admin.get('/api/v1/admin/shops').expect(200);
    });
  });

  describe('GET /admin/shops', () => {
    let pendingId: string;
    let approvedId: string;

    beforeAll(async () => {
      pendingId = (await createShop(sellerId, 'PENDING')).shopId;
      approvedId = (await createShop(userId, 'APPROVED')).shopId;
    });

    it('mặc định là hàng chờ duyệt: có shop PENDING, không có shop APPROVED', async () => {
      const res = await admin.get('/api/v1/admin/shops?limit=50').expect(200);
      const data = adminShopListResponseSchema.parse(body(res));

      expect(data.items.every((item) => item.status === 'PENDING')).toBe(true);
      expect(data.items.some((item) => item.id === approvedId)).toBe(false);
      expect(await findInList('PENDING', pendingId)).toBeDefined();
      expect(await findInList('APPROVED', approvedId)).toBeDefined();
    });

    it('mỗi shop kèm chủ shop (tên + email) và không lộ trường nào khác của user', async () => {
      const found = await findInList('PENDING', pendingId);

      expect(Object.keys(found!.owner).sort()).toEqual(['email', 'name']);
      expect(found!.owner.email).toContain(`${TAG}${stamp}seller`);
      expect(JSON.stringify(found)).not.toMatch(/passwordHash|refreshToken/);
    });

    it('`total` khớp số shop thật trong DB; phân trang không trùng shop giữa các trang', async () => {
      const dbTotal = await prisma.shop.count({ where: { status: 'PENDING' } });
      const page1 = adminShopListResponseSchema.parse(
        body(await admin.get('/api/v1/admin/shops?limit=1&page=1').expect(200)),
      );
      const page2 = adminShopListResponseSchema.parse(
        body(await admin.get('/api/v1/admin/shops?limit=1&page=2').expect(200)),
      );

      expect(page1.total).toBe(dbTotal);
      expect(page1.items).toHaveLength(1);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });

    it('hàng chờ duyệt xếp cũ nhất trước', async () => {
      const res = await admin.get('/api/v1/admin/shops?limit=50').expect(200);
      const created = adminShopListResponseSchema
        .parse(body(res))
        .items.map((item) => Date.parse(item.createdAt));

      expect(created).toEqual([...created].sort((a, b) => a - b));
    });

    it.each([
      ['status lạ', 'status=DELETED'],
      ['limit > 50', 'limit=51'],
      ['page = 0', 'page=0'],
      ['page không phải số', 'page=abc'],
    ])('query sai (%s) — 400', async (_, query) => {
      await admin.get(`/api/v1/admin/shops?${query}`).expect(400);
    });
  });

  describe('PATCH /admin/shops/:id/status', () => {
    describe('body không hợp lệ — 400, shop không đổi', () => {
      let shopId: string;

      beforeAll(async () => {
        shopId = (await createShop(sellerId, 'PENDING')).shopId;
      });

      it.each([
        ['từ chối thiếu lý do', { status: 'REJECTED' }],
        ['từ chối với lý do rỗng', { status: 'REJECTED', reason: '   ' }],
        ['khoá thiếu lý do', { status: 'SUSPENDED' }],
        [
          'lý do quá 500 ký tự',
          { status: 'REJECTED', reason: 'a'.repeat(501) },
        ],
        ['đích PENDING', { status: 'PENDING' }],
        ['status lạ', { status: 'DELETED' }],
        ['body rỗng', {}],
      ])('%s', async (_, payload) => {
        const res = await patchStatus(shopId, payload).expect(400);

        expect(errorBody(res).success).toBe(false);
        expect(await statusOf(shopId)).toEqual({
          status: 'PENDING',
          statusReason: null,
        });
      });

      it('thiếu lý do: thông báo nêu đúng field và key i18n', async () => {
        const res = await patchStatus(shopId, { status: 'SUSPENDED' }).expect(
          400,
        );

        expect(errorBody(res).message).toContain(
          'reason: admin.validationReasonRequired',
        );
      });
    });

    it('shop không tồn tại — 404', async () => {
      await patchStatus('khong-ton-tai', { status: 'APPROVED' }).expect(404);
    });

    it('duyệt: PENDING → APPROVED, trả shop kèm statusReason null', async () => {
      const { shopId } = await createShop(sellerId, 'PENDING');

      const res = await patchStatus(shopId, { status: 'APPROVED' }).expect(200);
      const shop = adminShopSchema.parse((body(res) as { shop: unknown }).shop);

      expect(shop.status).toBe('APPROVED');
      expect(shop.statusReason).toBeNull();
      expect(await statusOf(shopId)).toEqual({
        status: 'APPROVED',
        statusReason: null,
      });
    });

    it('từ chối: PENDING → REJECTED ghi lý do, và REJECTED là trạng thái cuối', async () => {
      const { shopId } = await createShop(sellerId, 'PENDING');

      const res = await patchStatus(shopId, {
        status: 'REJECTED',
        reason: '  Thiếu giấy phép kinh doanh  ',
      }).expect(200);
      const shop = (body(res) as { shop: AdminShop }).shop;

      expect(shop.status).toBe('REJECTED');
      expect(shop.statusReason).toBe('Thiếu giấy phép kinh doanh');

      for (const status of ['APPROVED', 'SUSPENDED']) {
        const blocked = await patchStatus(shopId, {
          status,
          reason: 'thử lại',
        }).expect(409);
        expect(errorBody(blocked).code).toBe('SHOP_INVALID_TRANSITION');
      }
      expect((await statusOf(shopId)).status).toBe('REJECTED');
    });

    it('khoá rồi mở khoá: lý do được ghi khi khoá và xoá khi mở khoá', async () => {
      const { shopId } = await createShop(sellerId, 'APPROVED');

      const locked = await patchStatus(shopId, {
        status: 'SUSPENDED',
        reason: 'Bán hàng cấm',
      }).expect(200);
      expect((body(locked) as { shop: AdminShop }).shop).toMatchObject({
        status: 'SUSPENDED',
        statusReason: 'Bán hàng cấm',
      });

      const unlocked = await patchStatus(shopId, {
        status: 'APPROVED',
        reason: 'lý do gửi kèm khi mở khoá bị bỏ qua',
      }).expect(200);
      expect((body(unlocked) as { shop: AdminShop }).shop).toMatchObject({
        status: 'APPROVED',
        statusReason: null,
      });
      expect(await statusOf(shopId)).toEqual({
        status: 'APPROVED',
        statusReason: null,
      });
    });

    it.each<[string, ShopStatus, string]>([
      ['duyệt shop không còn PENDING', 'APPROVED', 'APPROVED'],
      ['mở khoá shop đang APPROVED', 'APPROVED', 'APPROVED'],
      ['từ chối shop đã APPROVED', 'APPROVED', 'REJECTED'],
      ['khoá shop còn PENDING', 'PENDING', 'SUSPENDED'],
      ['khoá shop đã khoá', 'SUSPENDED', 'SUSPENDED'],
      ['từ chối shop đã khoá', 'SUSPENDED', 'REJECTED'],
    ])(
      '%s — 409 SHOP_INVALID_TRANSITION, shop không đổi',
      async (_, from, to) => {
        const { shopId } = await createShop(sellerId, from);
        await prisma.shop.update({
          where: { id: shopId },
          data: { statusReason: from === 'SUSPENDED' ? 'lý do cũ' : null },
        });

        const res = await patchStatus(shopId, {
          status: to,
          reason: 'có lý do',
        }).expect(409);

        expect(errorBody(res).code).toBe('SHOP_INVALID_TRANSITION');
        expect(await statusOf(shopId)).toEqual({
          status: from,
          statusReason: from === 'SUSPENDED' ? 'lý do cũ' : null,
        });
      },
    );

    it('race: 2 Admin duyệt và từ chối CÙNG 1 shop đồng thời ⇒ đúng 1 bên thắng, trạng thái khớp bên thắng', async () => {
      for (let round = 0; round < 6; round++) {
        const { shopId } = await createShop(sellerId, 'PENDING');

        const [approve, reject] = await Promise.all([
          patchStatus(shopId, { status: 'APPROVED' }),
          patchStatus(shopId, { status: 'REJECTED', reason: 'Từ chối' }),
        ]);

        expect([approve.status, reject.status].sort()).toEqual([200, 409]);
        const loser = approve.status === 409 ? approve : reject;
        expect(errorBody(loser).code).toBe('SHOP_INVALID_TRANSITION');

        const final = await statusOf(shopId);
        if (approve.status === 200) {
          expect(final).toEqual({ status: 'APPROVED', statusReason: null });
        } else {
          expect(final).toEqual({
            status: 'REJECTED',
            statusReason: 'Từ chối',
          });
        }
      }
    });
  });

  // Week8.md 3C.6: hàng chờ duyệt xếp theo mốc vào hàng chờ (statusChangedAt), và dòng danh sách cho thấy lịch sử
  // từ chối ⇄ nộp lại SUY TỪ ShopStatusHistory (không phải cột DB).
  describe('hàng chờ theo statusChangedAt + lịch sử từ chối ⇄ nộp lại', () => {
    const resubmit = (shopId: string, payload: Record<string, unknown> = {}) =>
      seller.post(`/api/v1/shops/${shopId}/resubmit`).send(payload);

    // Vị trí (theo thứ tự trả về của API, qua mọi trang) của các shop trong 1 tab — dev DB có thể còn nhiều shop
    // cũ nên không giả định hàng chờ chỉ có shop của test.
    async function queueOrder(status: ShopStatus, ids: string[]) {
      const seen: string[] = [];
      for (let page = 1; page <= 40; page++) {
        const res = await admin
          .get(`/api/v1/admin/shops?status=${status}&limit=50&page=${page}`)
          .expect(200);
        const data = adminShopListResponseSchema.parse(body(res));
        seen.push(
          ...data.items.map((item) => item.id).filter((id) => ids.includes(id)),
        );
        if (page * 50 >= data.total) break;
      }
      return seen;
    }

    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

    it('shop chưa từng bị từ chối: lastRejectionReason null, resubmissionCount 0', async () => {
      const { shopId } = await createShop(sellerId, 'PENDING');

      const found = await findInList('PENDING', shopId);

      expect(found).toMatchObject({
        lastRejectionReason: null,
        resubmissionCount: 0,
      });
    });

    it('từ chối ⇄ nộp lại 2 vòng: dòng danh sách trả lý do lần GẦN NHẤT và số lần nộp lại', async () => {
      const { shopId } = await createShop(sellerId, 'PENDING');

      await patchStatus(shopId, {
        status: 'REJECTED',
        reason: 'Thiếu giấy phép',
      }).expect(200);
      expect(await findInList('REJECTED', shopId)).toMatchObject({
        lastRejectionReason: 'Thiếu giấy phép',
        resubmissionCount: 0,
      });

      await resubmit(shopId).expect(200);
      expect(await findInList('PENDING', shopId)).toMatchObject({
        status: 'PENDING',
        statusReason: null, // lý do hiện tại đã xoá khi nộp lại...
        lastRejectionReason: 'Thiếu giấy phép', // ...nhưng Admin vẫn thấy lý do lần trước
        resubmissionCount: 1,
      });

      await patchStatus(shopId, {
        status: 'REJECTED',
        reason: 'Ảnh logo mờ',
      }).expect(200);
      await resubmit(shopId, { description: 'Đã đổi logo' }).expect(200);
      expect(await findInList('PENDING', shopId)).toMatchObject({
        lastRejectionReason: 'Ảnh logo mờ',
        resubmissionCount: 2,
      });
    });

    it('response của PATCH cũng có đủ 2 trường (FE parse bằng cùng adminShopSchema) và không lộ khối thô', async () => {
      const { shopId } = await createShop(sellerId, 'PENDING');

      const res = await patchStatus(shopId, {
        status: 'REJECTED',
        reason: 'Thiếu giấy phép',
      }).expect(200);
      const raw = (body(res) as { shop: Record<string, unknown> }).shop;

      expect(adminShopSchema.parse(raw)).toMatchObject({
        status: 'REJECTED',
        lastRejectionReason: 'Thiếu giấy phép',
        resubmissionCount: 0,
      });
      expect(raw).not.toHaveProperty('statusHistory');
      expect(raw).not.toHaveProperty('_count');
    });

    it('lý do từ chối lần trước là của chính shop đó (shop khác từ chối khác lý do không lẫn sang)', async () => {
      const a = await createShop(sellerId, 'PENDING');
      const b = await createShop(sellerId, 'PENDING');

      await patchStatus(a.shopId, {
        status: 'REJECTED',
        reason: 'Lý do của A',
      }).expect(200);
      await patchStatus(b.shopId, {
        status: 'REJECTED',
        reason: 'Lý do của B',
      }).expect(200);
      await resubmit(a.shopId).expect(200);
      await resubmit(b.shopId).expect(200);

      expect(await findInList('PENDING', a.shopId)).toMatchObject({
        lastRejectionReason: 'Lý do của A',
        resubmissionCount: 1,
      });
      expect(await findInList('PENDING', b.shopId)).toMatchObject({
        lastRejectionReason: 'Lý do của B',
        resubmissionCount: 1,
      });
    });

    it('hàng chờ: shop nộp lại xếp theo LÚC NỘP LẠI — không nhảy lên đầu hàng dù tạo từ lâu', async () => {
      const older = await createShop(sellerId, 'PENDING');
      const newer = await createShop(sellerId, 'PENDING');
      // older vào hàng chờ cách đây 2 giờ, newer cách đây 1 giờ.
      await prisma.shop.update({
        where: { id: older.shopId },
        data: { statusChangedAt: ago(120), createdAt: ago(120) },
      });
      await prisma.shop.update({
        where: { id: newer.shopId },
        data: { statusChangedAt: ago(60), createdAt: ago(60) },
      });
      const ids = [older.shopId, newer.shopId];

      expect(await queueOrder('PENDING', ids)).toEqual([
        older.shopId,
        newer.shopId,
      ]);

      // older bị từ chối rồi nộp lại BÂY GIỜ: mốc vào hàng chờ mới là bây giờ nên phải xếp SAU newer, dù
      // createdAt của older cũ hơn (nếu sắp theo createdAt, older sẽ vẫn nằm đầu hàng).
      await patchStatus(older.shopId, {
        status: 'REJECTED',
        reason: 'x',
      }).expect(200);
      await resubmit(older.shopId).expect(200);

      expect(await queueOrder('PENDING', ids)).toEqual([
        newer.shopId,
        older.shopId,
      ]);
    });

    it('các tab khác xếp theo lần đổi TRẠNG THÁI gần nhất, không phải updatedAt — chủ shop sửa thông tin không làm shop nhảy vị trí', async () => {
      const first = await createShop(sellerId, 'APPROVED');
      const second = await createShop(sellerId, 'APPROVED');
      await prisma.shop.update({
        where: { id: first.shopId },
        data: { statusChangedAt: ago(10) },
      });
      await prisma.shop.update({
        where: { id: second.shopId },
        data: { statusChangedAt: ago(120) },
      });
      const ids = [first.shopId, second.shopId];
      expect(await queueOrder('APPROVED', ids)).toEqual([
        first.shopId,
        second.shopId,
      ]);

      // Chủ shop sửa thông tin của shop CŨ hơn ⇒ updatedAt của nó mới nhất, nhưng thứ tự không đổi.
      await seller
        .patch(`/api/v1/shops/${second.shopId}`)
        .send({ description: 'Mô tả vừa sửa' })
        .expect(200);

      expect(await queueOrder('APPROVED', ids)).toEqual([
        first.shopId,
        second.shopId,
      ]);
    });
  });

  describe('khoá/mở khoá có hiệu lực ngay lên trang công khai và giỏ hàng (không sửa query nào)', () => {
    let shop: Awaited<ReturnType<typeof createShop>>;
    // Chủ shop riêng, chỉ có đúng 1 shop — để /shops/me (trả shop đầu tiên của user) xác định được.
    let owner: Awaited<ReturnType<typeof registerAndLogin>>;

    beforeAll(async () => {
      owner = await registerAndLogin('owner');
      shop = await createShop(owner.userId, 'PENDING');
      await addCartItem(prisma, buyerId, shop.variantId, 1);
    });

    it('shop chưa duyệt: sản phẩm không hiện công khai, mục trong giỏ không khả dụng', async () => {
      expect(await publicProductIds(shop.shopId)).toEqual([]);
      expect(await cartAvailability(shop.variantId)).toBe(false);
      await request(app.getHttpServer())
        .get(`/api/v1/products/${shop.productId}`)
        .expect(404);
    });

    it('sau khi duyệt: sản phẩm hiện ở danh sách + chi tiết công khai, mục trong giỏ khả dụng', async () => {
      await patchStatus(shop.shopId, { status: 'APPROVED' }).expect(200);

      expect(await publicProductIds(shop.shopId)).toEqual([shop.productId]);
      expect(await cartAvailability(shop.variantId)).toBe(true);
      await request(app.getHttpServer())
        .get(`/api/v1/products/${shop.productId}`)
        .expect(200);
    });

    it('sau khi khoá: sản phẩm biến khỏi danh sách + chi tiết, mục trong giỏ không khả dụng; dữ liệu giữ nguyên', async () => {
      await patchStatus(shop.shopId, {
        status: 'SUSPENDED',
        reason: 'Vi phạm chính sách',
      }).expect(200);

      expect(await publicProductIds(shop.shopId)).toEqual([]);
      expect(await cartAvailability(shop.variantId)).toBe(false);
      await request(app.getHttpServer())
        .get(`/api/v1/products/${shop.productId}`)
        .expect(404);

      // Không xoá/ẩn gì: sản phẩm vẫn PUBLISHED, mục giỏ vẫn còn (chỉ không khả dụng).
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: shop.productId },
        select: { status: true },
      });
      expect(product.status).toBe('PUBLISHED');
    });

    it('Seller vẫn đăng nhập được và thấy trạng thái + lý do khoá ở /shops/me', async () => {
      const res = await owner.agent.get('/api/v1/shops/me').expect(200);
      const mine = shopSchema.parse((body(res) as { shop: unknown }).shop);

      expect(mine).toMatchObject({
        id: shop.shopId,
        status: 'SUSPENDED',
        statusReason: 'Vi phạm chính sách',
      });
    });

    it('sau khi mở khoá: mọi thứ hiện lại nguyên vẹn, lý do bị xoá', async () => {
      await patchStatus(shop.shopId, { status: 'APPROVED' }).expect(200);

      expect(await publicProductIds(shop.shopId)).toEqual([shop.productId]);
      expect(await cartAvailability(shop.variantId)).toBe(true);
      expect(await statusOf(shop.shopId)).toEqual({
        status: 'APPROVED',
        statusReason: null,
      });
    });
  });
});
