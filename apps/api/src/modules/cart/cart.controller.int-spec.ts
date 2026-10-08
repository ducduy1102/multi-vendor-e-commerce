import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type ShopStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { cartResponseSchema } from '@ecommerce/types';
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

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho luật "người bán không được mua sản phẩm của
// chính shop mình" ở giỏ hàng (Week9.md 2.10, bổ sung sau khi làm đánh giá: nếu được tự mua thì tự đánh giá là
// cách rẻ nhất để nâng điểm). Chứng minh điều unit test với mock không chứng minh được: câu SELECT thật có trả về
// chủ shop để so sánh, response không lộ định danh chủ shop, và luật chỉ áp lên ĐÚNG chủ shop (người khác vẫn
// thêm được chính sản phẩm đó). Chạy: `pnpm test:int`.
const TAG = 'it-cart-own-';
const PASSWORD = 'password123';

const fakeMail = createFakeMail();

describe('Giỏ hàng — người bán không được tự mua (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  interface Account {
    agent: Agent;
    userId: string;
  }

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const message = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  async function registerAndLogin(suffix: string): Promise<Account> {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`.toLowerCase();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}${suffix}` })
      .expect(201);
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: user.id };
  }

  // Shop do `ownerId` làm chủ ở trạng thái `status`, có 1 sản phẩm PUBLISHED + 1 variant còn 10 hàng.
  async function createShopFor(
    ownerId: string,
    status: ShopStatus = 'APPROVED',
  ) {
    const base = await createShopWithProduct(prisma, TAG);
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { ownerId, status },
    });
    const variant = await createVariant(prisma, base, {
      stock: 10,
      price: 100_000,
    });
    return { ...base, variantId: variant.id };
  }

  const cartLines = async (userId: string) =>
    prisma.cartItem.findMany({
      where: { cart: { userId } },
      select: { id: true, productVariantId: true, quantity: true },
    });

  let seller: Account;
  let sellerOwnVariantId: string;
  let sellerOwnShopId: string;
  let otherVariantId: string;
  let anonymous: Agent;

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

    anonymous = newAgent();
    seller = await registerAndLogin('seller');
    const otherOwner = await registerAndLogin('other-owner');
    const own = await createShopFor(seller.userId);
    const other = await createShopFor(otherOwner.userId);
    sellerOwnVariantId = own.variantId;
    sellerOwnShopId = own.shopId;
    otherVariantId = other.variantId;
  });

  afterEach(async () => {
    // Mỗi test bắt đầu với giỏ của seller trống.
    await prisma.cartItem.deleteMany({
      where: { cart: { userId: seller.userId } },
    });
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /cart/items', () => {
    it('sản phẩm của CHÍNH shop mình ⇒ 409 CART_OWN_SHOP_ITEM, không ghi gì (kể cả không tạo giỏ)', async () => {
      const lonelySeller = await registerAndLogin('lonely-seller');
      const shop = await createShopFor(lonelySeller.userId);

      const res = await lonelySeller.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: shop.variantId, quantity: 1 });

      expect(res.status).toBe(409);
      expect(code(res)).toBe('CART_OWN_SHOP_ITEM');
      expect(message(res)).toBe('You cannot buy products from your own shop');
      expect(await cartLines(lonelySeller.userId)).toHaveLength(0);
      expect(
        await prisma.cart.findUnique({
          where: { userId: lonelySeller.userId },
        }),
      ).toBeNull();
    });

    it('chủ shop vẫn thêm được sản phẩm của shop KHÁC', async () => {
      const res = await seller.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: otherVariantId, quantity: 2 });

      expect(res.status).toBe(201);
      expect(await cartLines(seller.userId)).toEqual([
        expect.objectContaining({
          productVariantId: otherVariantId,
          quantity: 2,
        }),
      ]);
    });

    it('luật chỉ áp lên ĐÚNG chủ shop: người khác thêm chính sản phẩm đó bình thường', async () => {
      const buyer = await registerAndLogin('plain-buyer');

      const res = await buyer.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: sellerOwnVariantId, quantity: 1 });

      expect(res.status).toBe(201);
    });

    it('shop của mình chưa được duyệt ⇒ báo CART_ITEM_UNAVAILABLE như mọi người (không bán thì không có chuyện tự mua)', async () => {
      const pendingOwner = await registerAndLogin('pending-owner');
      const pending = await createShopFor(pendingOwner.userId, 'PENDING');

      const res = await pendingOwner.agent
        .post('/api/v1/cart/items')
        .send({ productVariantId: pending.variantId, quantity: 1 });

      expect(res.status).toBe(409);
      expect(code(res)).toBe('CART_ITEM_UNAVAILABLE');
    });

    it('chưa đăng nhập ⇒ 401', async () => {
      const res = await anonymous
        .post('/api/v1/cart/items')
        .send({ productVariantId: sellerOwnVariantId, quantity: 1 });

      expect(res.status).toBe(401);
    });
  });

  describe('dòng của shop mình đã nằm sẵn trong giỏ từ trước khi có luật chặn', () => {
    it('GET /cart: dòng đó isAvailable=false + unavailableReason OWN_SHOP, không cộng vào tổng; dòng shop khác bình thường; KHÔNG lộ định danh chủ shop', async () => {
      await addCartItem(prisma, seller.userId, sellerOwnVariantId, 3);
      await addCartItem(prisma, seller.userId, otherVariantId, 1);

      const res = await seller.agent.get('/api/v1/cart').expect(200);

      const { cart } = cartResponseSchema.parse(data(res));
      const lines = cart.shops.flatMap((shop) => shop.items);
      const own = lines.find((l) => l.productVariantId === sellerOwnVariantId);
      const other = lines.find((l) => l.productVariantId === otherVariantId);
      expect(own).toMatchObject({
        isAvailable: false,
        unavailableReason: 'OWN_SHOP',
        quantity: 3,
      });
      expect(other?.isAvailable).toBe(true);
      expect(other).not.toHaveProperty('unavailableReason');
      expect(cart.subtotal).toBe('100000'); // chỉ dòng shop khác
      expect(cart.itemCount).toBe(2); // dòng của shop mình vẫn hiện và được đếm
      expect(
        cart.shops.find((s) => s.shopId === sellerOwnShopId)?.subtotal,
      ).toBe('0');
      expect(JSON.stringify(res.body)).not.toContain(seller.userId);
    });

    it('cùng giỏ đó nhìn từ người KHÁC (chỉ trong test: đưa dòng vào giỏ người đó) thì không bị loại', async () => {
      const buyer = await registerAndLogin('viewer-buyer');
      await addCartItem(prisma, buyer.userId, sellerOwnVariantId, 1);

      const res = await buyer.agent.get('/api/v1/cart').expect(200);

      const { cart } = cartResponseSchema.parse(data(res));
      expect(cart.shops[0].items[0].isAvailable).toBe(true);
    });

    it('PATCH /cart/items/:id ⇒ 409 CART_OWN_SHOP_ITEM, số lượng không đổi; DELETE vẫn xoá được', async () => {
      const row = await addCartItem(
        prisma,
        seller.userId,
        sellerOwnVariantId,
        3,
      );

      const patch = await seller.agent
        .patch(`/api/v1/cart/items/${row.id}`)
        .send({ quantity: 1 });
      expect(patch.status).toBe(409);
      expect(code(patch)).toBe('CART_OWN_SHOP_ITEM');
      expect((await cartLines(seller.userId))[0].quantity).toBe(3);

      await seller.agent.delete(`/api/v1/cart/items/${row.id}`).expect(200);
      expect(await cartLines(seller.userId)).toHaveLength(0);
    });
  });

  describe('POST /cart/merge — gộp giỏ guest sau đăng nhập', () => {
    it('bỏ qua thầm lặng sản phẩm của shop mình, vẫn gộp phần còn lại; không tính vào droppedLineCount', async () => {
      const res = await seller.agent.post('/api/v1/cart/merge').send({
        items: [
          { productVariantId: sellerOwnVariantId, quantity: 1 },
          { productVariantId: otherVariantId, quantity: 1 },
        ],
      });

      expect(res.status).toBe(200);
      const body = data(res) as { droppedLineCount: number };
      expect(body.droppedLineCount).toBe(0);
      expect(
        (await cartLines(seller.userId)).map((l) => l.productVariantId),
      ).toEqual([otherVariantId]);
    });
  });

  describe('POST /cart/quote', () => {
    const body = () => ({
      items: [{ productVariantId: sellerOwnVariantId, quantity: 1 }],
    });

    it('đã đăng nhập (có cookie) ⇒ dòng của shop mình bị loại; guest không biết người xem là ai ⇒ không áp luật', async () => {
      const asOwner = await seller.agent
        .post('/api/v1/cart/quote')
        .send(body());
      const asGuest = await anonymous.post('/api/v1/cart/quote').send(body());

      expect(asOwner.status).toBe(200);
      const ownerLine = cartResponseSchema.parse(data(asOwner)).cart.shops[0]
        .items[0];
      expect(ownerLine).toMatchObject({
        isAvailable: false,
        unavailableReason: 'OWN_SHOP',
      });
      const guestLine = cartResponseSchema.parse(data(asGuest)).cart.shops[0]
        .items[0];
      expect(guestLine.isAvailable).toBe(true);
    });
  });
});
