import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type ShopStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { publicShopSchema } from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  cleanupByTag,
  createShopWithProduct,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho trang shop công khai (Week9.md 1.10/5.5):
// `GET /shops/:slug` và bộ lọc `GET /products?shopSlug=`. Chứng minh điều unit test với mock không chứng minh
// được: câu SQL thống kê thật cho đúng số liệu (trọng số, làm tròn, chỉ tính sản phẩm PUBLISHED), kiểu number
// ra JSON, route `me` vẫn tới đúng handler, và shop chưa duyệt không lộ qua BẤT KỲ đường nào của hai route.
// Chạy: `pnpm test:int`.
const TAG = 'it-shop-public-';
const PASSWORD = 'password123';

const fakeMail = createFakeMail();

describe('Trang shop công khai (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const raw = () => request(app.getHttpServer());
  const newAgent = () => request.agent(app.getHttpServer());

  const data = (res: { body: unknown }) =>
    (res.body as { data: Record<string, unknown> }).data;

  // Shop APPROVED (hoặc `status`) có sẵn 1 sản phẩm PUBLISHED từ fixture; trả slug và categoryId để thêm sản phẩm.
  async function createShop(
    options: {
      status?: ShopStatus;
      description?: string | null;
      logoUrl?: string | null;
    } = {},
  ) {
    const base = await createShopWithProduct(prisma, TAG);
    const shop = await prisma.shop.update({
      where: { id: base.shopId },
      data: {
        status: options.status ?? 'APPROVED',
        description: options.description ?? null,
        logoUrl: options.logoUrl ?? null,
      },
      select: { id: true, slug: true, ownerId: true },
    });
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: base.productId },
      select: { id: true, categoryId: true },
    });
    return {
      shopId: shop.id,
      slug: shop.slug,
      ownerId: shop.ownerId,
      categoryId: product.categoryId,
      firstProductId: product.id,
    };
  }

  async function addProduct(
    shop: { shopId: string; categoryId: string },
    options: {
      status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
      avgRating?: number;
      reviewCount?: number;
    } = {},
  ) {
    counter += 1;
    const product = await prisma.product.create({
      data: {
        shopId: shop.shopId,
        categoryId: shop.categoryId,
        name: `${TAG}extra-${stamp}-${counter}`,
        slug: `${TAG}extra-${stamp}-${counter}`,
        status: options.status ?? 'PUBLISHED',
        minPrice: 100000,
        maxPrice: 100000,
        avgRating: options.avgRating ?? 0,
        reviewCount: options.reviewCount ?? 0,
      },
      select: { id: true },
    });
    return product.id;
  }

  async function setRating(
    productId: string,
    avgRating: number,
    reviewCount: number,
  ) {
    await prisma.product.update({
      where: { id: productId },
      data: { avgRating, reviewCount },
    });
  }

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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên để supertest không tự listen/close theo từng request.
    await app.listen(0);
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await app.close();
  });

  // --- GET /shops/:slug -------------------------------------------------------------------------

  describe('GET /shops/:slug', () => {
    it('shop APPROVED: đủ field công khai, số liệu CHỈ tính sản phẩm PUBLISHED, trọng số theo số lượt đánh giá', async () => {
      const shop = await createShop({
        description: 'Chuyên áo thun',
        logoUrl: 'https://res.cloudinary.com/demo/logo.png',
      });
      // Sản phẩm PUBLISHED từ fixture: 4.5 sao × 2 lượt. Thêm: 3.0 × 1, chưa có đánh giá.
      await setRating(shop.firstProductId, 4.5, 2);
      await addProduct(shop, { avgRating: 3, reviewCount: 1 });
      await addProduct(shop);
      // Không được tính: bản nháp và đã lưu trữ dù có đánh giá rất cao/thấp.
      await addProduct(shop, {
        status: 'DRAFT',
        avgRating: 5,
        reviewCount: 10,
      });
      await addProduct(shop, {
        status: 'ARCHIVED',
        avgRating: 1,
        reviewCount: 5,
      });

      const res = await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);

      const body = data(res).shop as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        [
          'avgRating',
          'bannerUrl',
          'createdAt',
          'description',
          'id',
          'logoUrl',
          'name',
          'productCount',
          'reviewCount',
          'slug',
        ].sort(),
      );
      expect(body).toMatchObject({
        id: shop.shopId,
        slug: shop.slug,
        description: 'Chuyên áo thun',
        logoUrl: 'https://res.cloudinary.com/demo/logo.png',
        bannerUrl: null,
        productCount: 3,
        // (4.5×2 + 3.0×1 + 0×0) / 3 lượt = 4.0
        reviewCount: 3,
        avgRating: 4,
      });
      // Kiểu number thật ở JSON (không phải chuỗi/BigInt) và khớp schema dùng chung của FE.
      expect(typeof body.productCount).toBe('number');
      expect(typeof body.avgRating).toBe('number');
      expect(typeof body.reviewCount).toBe('number');
      expect(publicShopSchema.safeParse(body).success).toBe(true);
    });

    it('KHÔNG lộ chủ shop hay trạng thái: không ownerId/status/statusReason/updatedAt, không email hay id chủ ở bất kỳ chỗ nào', async () => {
      const shop = await createShop();
      const owner = await prisma.user.findUniqueOrThrow({
        where: { id: shop.ownerId },
        select: { email: true },
      });

      const res = await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);

      const text = JSON.stringify(res.body);
      for (const key of [
        'ownerId',
        'status',
        'statusReason',
        'statusChangedAt',
        'updatedAt',
        'owner',
      ]) {
        expect(text).not.toContain(`"${key}"`);
      }
      expect(text).not.toContain(owner.email);
      expect(text).not.toContain(shop.ownerId);
    });

    it('làm tròn half-up 2 chữ số bằng NUMERIC: (4.33×3 + 4.5×2) / 5 = 4.398 ⇒ 4.4', async () => {
      const shop = await createShop();
      await setRating(shop.firstProductId, 4.33, 3);
      await addProduct(shop, { avgRating: 4.5, reviewCount: 2 });

      const res = await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);

      expect(data(res).shop).toMatchObject({
        avgRating: 4.4,
        reviewCount: 5,
        productCount: 2,
      });
    });

    it('shop chưa có đánh giá nào: avgRating 0, reviewCount 0 (không NaN/null); chưa có sản phẩm PUBLISHED: productCount 0', async () => {
      const shop = await createShop();
      await prisma.product.update({
        where: { id: shop.firstProductId },
        data: { status: 'DRAFT' },
      });

      const res = await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);

      expect(data(res).shop).toMatchObject({
        productCount: 0,
        reviewCount: 0,
        avgRating: 0,
      });
    });

    it('khách và người đã đăng nhập nhận CÙNG nội dung (không guard, không dữ liệu theo viewer)', async () => {
      const shop = await createShop();
      const agent = newAgent();
      counter += 1;
      const email = `${TAG}${stamp}-viewer-${counter}@test.local`;
      await agent
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: 'Viewer' })
        .expect(201);
      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const guest = await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);
      const loggedIn = await agent
        .get(`/api/v1/shops/${shop.slug}`)
        .expect(200);

      expect(loggedIn.body).toEqual(guest.body);
    });

    it.each(['PENDING', 'REJECTED', 'SUSPENDED'] as const)(
      'shop %s ⇒ 404, CÙNG nội dung với slug không tồn tại (không lộ shop chưa duyệt có tồn tại)',
      async (status) => {
        const shop = await createShop({ status });

        const hidden = await raw()
          .get(`/api/v1/shops/${shop.slug}`)
          .expect(404);
        const unknown = await raw()
          .get(`/api/v1/shops/${TAG}khong-ton-tai-${stamp}`)
          .expect(404);

        expect(hidden.body).toEqual(unknown.body);
      },
    );

    it.each([
      ['chữ hoa', 'Shop-A'],
      ['khoảng trắng', 'shop%20a'],
      ['đường dẫn lên trên', '..%2Fetc'],
      ['ký tự SQL', "x'%20OR%201=1--"],
      ['quá dài', 'a'.repeat(300)],
    ])('slug %s ⇒ 404 (không lỗi 500, không lộ gì)', async (_label, slug) => {
      const res = await raw().get(`/api/v1/shops/${slug}`);

      expect(res.status).toBe(404);
    });

    it('shop đang APPROVED rồi bị khoá (SUSPENDED) ⇒ ngay lập tức 404', async () => {
      const shop = await createShop();
      await raw().get(`/api/v1/shops/${shop.slug}`).expect(200);

      await prisma.shop.update({
        where: { id: shop.shopId },
        data: { status: 'SUSPENDED' },
      });

      await raw().get(`/api/v1/shops/${shop.slug}`).expect(404);
    });
  });

  // --- GET /shops/me vẫn tới đúng handler ------------------------------------------------------

  describe('GET /shops/me không bị :slug nuốt mất', () => {
    it('khách ⇒ 401 (handler riêng cần đăng nhập), không phải 404 "shop không tồn tại"', async () => {
      await raw().get('/api/v1/shops/me').expect(401);
    });

    it('chủ shop đã đăng nhập ⇒ 200 với shop của CHÍNH MÌNH (có ownerId — dạng đầy đủ, khác dạng công khai)', async () => {
      const shop = await createShop({ status: 'PENDING' });
      const agent = newAgent();
      counter += 1;
      const email = `${TAG}${stamp}-owner-${counter}@test.local`;
      await agent
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: 'Owner' })
        .expect(201);
      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });
      await prisma.shop.update({
        where: { id: shop.shopId },
        data: { ownerId: user.id },
      });

      const res = await agent.get('/api/v1/shops/me').expect(200);

      // Shop đang PENDING nên route công khai 404, nhưng chủ vẫn thấy qua /me.
      expect(data(res).shop).toMatchObject({
        id: shop.shopId,
        ownerId: user.id,
        status: 'PENDING',
      });
      await raw().get(`/api/v1/shops/${shop.slug}`).expect(404);
    });
  });

  // --- GET /products?shopSlug= ------------------------------------------------------------------

  describe('GET /products?shopSlug=', () => {
    const listBySlug = (query: string) =>
      raw().get(`/api/v1/products?${query}`);
    const idsOf = (res: { body: unknown }) =>
      ((data(res) as { items: { id: string }[] }).items ?? [])
        .map((item) => item.id)
        .sort();
    const totalOf = (res: { body: unknown }) =>
      (data(res) as { total: number }).total;

    it('chỉ trả sản phẩm PUBLISHED của đúng shop có slug đó', async () => {
      const shop = await createShop();
      const other = await createShop();
      const second = await addProduct(shop);
      await addProduct(shop, { status: 'DRAFT' });
      await addProduct(shop, { status: 'ARCHIVED' });

      const res = await listBySlug(`shopSlug=${shop.slug}`).expect(200);

      expect(idsOf(res)).toEqual([shop.firstProductId, second].sort());
      expect(idsOf(res)).not.toContain(other.firstProductId);
      expect(totalOf(res)).toBe(2);
    });

    it('shopSlug + shopId KHÔNG khớp nhau ⇒ danh sách rỗng; khớp ⇒ như bình thường', async () => {
      const shop = await createShop();
      const other = await createShop();

      const mismatch = await listBySlug(
        `shopSlug=${shop.slug}&shopId=${other.shopId}`,
      ).expect(200);
      const match = await listBySlug(
        `shopSlug=${shop.slug}&shopId=${shop.shopId}`,
      ).expect(200);

      expect(totalOf(mismatch)).toBe(0);
      expect(idsOf(match)).toEqual([shop.firstProductId]);
    });

    it.each(['PENDING', 'REJECTED', 'SUSPENDED'] as const)(
      'slug của shop %s ⇒ rỗng (sản phẩm của shop chưa duyệt không lộ qua shopSlug)',
      async (status) => {
        const shop = await createShop({ status });

        const res = await listBySlug(`shopSlug=${shop.slug}`).expect(200);

        expect(totalOf(res)).toBe(0);
      },
    );

    it('slug không tồn tại hoặc sai định dạng ⇒ 200 rỗng; quá dài ⇒ 400', async () => {
      expect(
        totalOf(await listBySlug(`shopSlug=${TAG}khong-co`).expect(200)),
      ).toBe(0);
      expect(
        totalOf(await listBySlug('shopSlug=Sai%20Dinh%20Dang').expect(200)),
      ).toBe(0);
      await listBySlug(`shopSlug=${'a'.repeat(151)}`).expect(400);
    });

    it('kết hợp được với sort/phân trang (shopSlug + sort=rating + limit)', async () => {
      const shop = await createShop();
      await setRating(shop.firstProductId, 2, 4);
      const high = await addProduct(shop, { avgRating: 5, reviewCount: 3 });

      const res = await listBySlug(
        `shopSlug=${shop.slug}&sort=rating&limit=1`,
      ).expect(200);

      expect(
        (data(res) as { items: { id: string }[] }).items.map((i) => i.id),
      ).toEqual([high]);
      expect(totalOf(res)).toBe(2);
    });
  });

  // --- slug dành riêng ---------------------------------------------------------------------------

  describe('slug dành riêng "me"', () => {
    it('tạo shop tên "Me" ⇒ slug tự sinh là me-2 (me không bao giờ mở được trang công khai); tự nhập slug me ⇒ 400', async () => {
      const agent = newAgent();
      counter += 1;
      const email = `${TAG}${stamp}-reserved-${counter}@test.local`;
      await agent
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: 'Reserved' })
        .expect(201);
      await prisma.user.update({
        where: { email },
        data: { emailVerifiedAt: new Date() },
      });
      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      await agent
        .post('/api/v1/shops')
        .send({ name: 'Shop', slug: 'me' })
        .expect(400);

      const created = await agent
        .post('/api/v1/shops')
        .send({ name: 'Me' })
        .expect(201);
      const slug = (data(created).shop as { slug: string }).slug;

      expect(slug).not.toBe('me');
      expect(slug).toMatch(/^me-\d+$/);
      // Dọn: slug này không có tiền tố TAG nên cleanupByTag không tự xoá theo slug — xoá theo chủ shop.
      await prisma.shopStatusHistory.deleteMany({
        where: { shop: { slug } },
      });
      await prisma.shop.deleteMany({ where: { slug } });
    });
  });
});
