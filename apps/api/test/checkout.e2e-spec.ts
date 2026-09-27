import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/shared/interceptors/transform-response.interceptor';
import {
  cleanupByTag,
  createShopWithProduct,
  createVariant,
} from '../src/shared/testing/db-fixtures';

// e2e THẬT qua HTTP (Week7.md 2.13 — "luồng quan trọng nhất"): đăng ký → xác thực email → thêm
// giỏ → thêm địa chỉ → đặt hàng → thanh toán (MockPaymentProvider) → kiểm DB. Repo trước đây chỉ có
// test/app.e2e-spec.ts mặc định (kiểm "Hello World!") — dựng nền DB test/dọn dữ liệu riêng ở đây,
// khác `*.int-spec.ts` (gọi thẳng service) vì e2e này đi qua TOÀN BỘ HTTP layer bằng supertest,
// đúng tinh thần `rules/backend.md` mục 7 ("ưu tiên e2e cho luồng checkout").
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy — dùng chung `DATABASE_URL` với `pnpm test:int`).
// Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll giống các `*.int-spec.ts` khác. Bật
// `PAYMENT_MOCK_ENABLED=true` chỉ trong file này rồi trả lại giá trị cũ (không rò sang test khác).
const TAG = 'e2e-checkout-';

describe('Luồng checkout (e2e thật qua HTTP)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const originalMockFlag = process.env.PAYMENT_MOCK_ENABLED;

  beforeAll(async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    await cleanupByTag(prisma, TAG);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // JwtStrategy đọc access_token từ cookie httpOnly (không phải header) — thiếu middleware này thì
    // req.cookies luôn undefined và MỌI request coi như chưa đăng nhập (401), giống main.ts thật.
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    if (originalMockFlag === undefined) {
      delete process.env.PAYMENT_MOCK_ENABLED;
    } else {
      process.env.PAYMENT_MOCK_ENABLED = originalMockFlag;
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('đăng ký → xác thực email → giỏ → địa chỉ → đặt hàng → thanh toán thành công (mock) → DB đúng trạng thái cuối', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = `${TAG}${Date.now()}@test.local`;
    const password = 'password123';

    // 1. Đăng ký — KHÔNG tự đăng nhập (đúng thiết kế AuthController.register).
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password, name: `${TAG}user` })
      .expect(201);

    // 2. "Xác thực email" — bỏ qua đường gửi mail thật (Resend không cấu hình ở môi trường test,
    // và bản thân luồng gửi/click link verify đã có test riêng ở module auth) — set thẳng
    // emailVerifiedAt để mô phỏng đúng trạng thái SAU KHI user đã bấm link, không test lại cơ chế đó.
    await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });

    // 3. Đăng nhập thật — agent giữ cookie httpOnly cho mọi request sau.
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    // 4. Dựng sẵn 1 shop/sản phẩm/variant còn hàng bằng Prisma trực tiếp — luồng Seller đăng ký
    // shop/đăng sản phẩm là 1 hành trình KHÁC, ngoài phạm vi e2e checkout này.
    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, {
      stock: 10,
      price: 150_000,
    });

    // 5. Thêm vào giỏ qua API thật.
    await agent
      .post('/api/v1/cart/items')
      .send({ productVariantId: variant.id, quantity: 2 })
      .expect(201);

    // 6. Thêm địa chỉ giao hàng qua API thật.
    const addressRes = await agent
      .post('/api/v1/addresses')
      .send({
        recipientName: 'Nguyễn Văn A',
        phone: '0912345678',
        line1: '12 Nguyễn Huệ',
        ward: 'Phường Bến Nghé',
        province: 'Hồ Chí Minh',
      })
      .expect(201);
    const addressId = (addressRes.body as { data: { address: { id: string } } })
      .data.address.id;

    // 7. Xem trước — lấy `grandTotal` THẬT từ BE (đúng luồng thật, không tự tính tay ở test).
    const previewRes = await agent
      .post('/api/v1/checkout/preview')
      .send({ addressId })
      .expect(200);
    const grandTotal = Number(
      (previewRes.body as { data: { grandTotal: string } }).data.grandTotal,
    );
    expect(grandTotal).toBeGreaterThan(0);

    // 8. Đặt hàng thật.
    const checkoutRes = await agent
      .post('/api/v1/checkout')
      .send({ addressId, paymentMethod: 'VNPAY', expectedTotal: grandTotal })
      .expect(201);
    const { checkoutGroupId, paymentUrl } = (
      checkoutRes.body as {
        data: { checkoutGroupId: string; paymentUrl: string | null };
      }
    ).data;
    expect(typeof paymentUrl).toBe('string');

    // Sau khi đặt: kho đã GIỮ CHỖ (chưa trừ vật lý), giỏ đã xoá đúng dòng vừa mua.
    expect(
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        select: { stock: true, reservedStock: true },
      }),
    ).toEqual({ stock: 10, reservedStock: 2 });
    expect(
      await prisma.cartItem.count({ where: { cart: { user: { email } } } }),
    ).toBe(0);

    // 9. Thanh toán qua Mock — đi ĐÚNG payUrl do chính BE ký và trả về ở bước 8, gọi thật qua HTTP
    // (không tự dựng lại chữ ký ở test) rồi thêm outcome=SUCCESS để chọn kết quả.
    const url = new URL(paymentUrl!);
    const confirmRes = await agent
      .get(`${url.pathname}${url.search}&outcome=SUCCESS`)
      .expect(302);
    expect(confirmRes.headers.location).toContain(
      `/checkout/result?groupId=${checkoutGroupId}`,
    );

    // 10. DB cuối: đơn đã thanh toán (PENDING = chờ shop xác nhận, Week7.md 1.13), kho đã CHỐT thật
    // (stock giảm, reservedStock về 0), Payment SUCCESS.
    const order = await prisma.order.findFirstOrThrow({
      where: { checkoutGroupId },
      select: { status: true },
    });
    expect(order.status).toBe('PENDING');
    expect(
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        select: { stock: true, reservedStock: true },
      }),
    ).toEqual({ stock: 8, reservedStock: 0 });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { checkoutGroupId },
    });
    expect(payment.status).toBe('SUCCESS');

    // 11. Trang kết quả đọc được đúng nhóm này qua API thật (chỉ chủ nhóm xem được).
    const groupRes = await agent
      .get(`/api/v1/checkout/groups/${checkoutGroupId}`)
      .expect(200);
    expect((groupRes.body as { data: { status: string } }).data.status).toBe(
      'PAID',
    );
  });

  it('email chưa xác thực — POST /checkout bị chặn 403 EMAIL_NOT_VERIFIED, không tạo gì trong DB', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = `${TAG}unverified-${Date.now()}@test.local`;
    const password = 'password123';

    await agent
      .post('/api/v1/auth/register')
      .send({ email, password, name: `${TAG}user2` })
      .expect(201);
    // KHÔNG set emailVerifiedAt — cố tình để trạng thái "chưa xác thực".
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const base = await createShopWithProduct(prisma, TAG);
    const variant = await createVariant(prisma, base, {
      stock: 5,
      price: 100_000,
    });
    await agent
      .post('/api/v1/cart/items')
      .send({ productVariantId: variant.id, quantity: 1 })
      .expect(201);
    const addressRes = await agent
      .post('/api/v1/addresses')
      .send({
        recipientName: 'B',
        phone: '0912345678',
        line1: '1 A',
        ward: 'X',
        province: 'Hồ Chí Minh',
      })
      .expect(201);
    const addressId = (addressRes.body as { data: { address: { id: string } } })
      .data.address.id;

    const res = await agent
      .post('/api/v1/checkout')
      .send({ addressId, paymentMethod: 'VNPAY', expectedTotal: 100_000 })
      .expect(403);
    expect((res.body as { code?: string }).code).toBe('EMAIL_NOT_VERIFIED');

    expect(await prisma.order.count({ where: { shopId: base.shopId } })).toBe(
      0,
    );
    expect(
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        select: { reservedStock: true },
      }),
    ).toEqual({ reservedStock: 0 });
  });
});
