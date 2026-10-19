import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type UserLocale } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MockPaymentProvider } from '../../shared/payment/mock-payment.provider';
import {
  cleanupByTag,
  createCheckoutGroup,
  createUser,
} from '../../shared/testing/db-fixtures';

const TAG = 'it-ordctl-';

// Integration test qua HTTP THẬT (supertest, cần Postgres đang chạy) — chứng minh cái mà unit test
// gọi thẳng service KHÔNG chứng minh được: endpoint IPN của VNPay trả đúng {RspCode, Message} Ở MỨC
// GỐC, không bị TransformResponseInterceptor/AllExceptionsFilter toàn cục bọc thành
// {success, data: {RspCode}} (Week7.md 1.10, 2.9 — bẫy `@Res()` không passthrough). Bootstrap lại
// đúng những gì main.ts làm (setGlobalPrefix/interceptor/filter) vì test/app.e2e-spec.ts mặc định
// không có. Chạy: `pnpm test:int`.
describe('OrderController — payment gateway endpoints (HTTP thật)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Đối chứng: 1 endpoint THƯỜNG (không phải cổng thanh toán gọi) PHẢI bị bọc — chứng minh
  // interceptor/filter toàn cục thật sự đang hoạt động, không phải "chưa từng chạy".
  it('endpoint thường (GET /) VẪN bị bọc {success, data} như bình thường', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: 'Hello World!' });
  });

  it('GET /payments/vnpay/ipn trả {RspCode, Message} Ở MỨC GỐC — KHÔNG bị bọc {success, data}', async () => {
    // Không cấu hình VNPAY_* trong môi trường test ⇒ isVnpayConfigured() = false ⇒
    // verifyCallback() luôn coi là sai chữ ký, bất kể query — đủ để kiểm hình dạng response.
    const res = await request(app.getHttpServer()).get(
      '/api/v1/payments/vnpay/ipn',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ RspCode: '97', Message: 'Invalid signature' });
    // Khẳng định KHÔNG có 'success'/'data' — bắt được lỗi "quên @Res() non-passthrough" nếu ai lỡ đổi.
    expect(res.body).not.toHaveProperty('success');
    expect(res.body).not.toHaveProperty('data');
  });

  it('GET /payments/vnpay/return với chữ ký sai — 302 redirect /checkout/result?error=invalid, không lộ query gốc', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/payments/vnpay/return')
      .query({ vnp_TxnRef: 'SOMETHING', vnp_ResponseCode: '00' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/checkout/result?error=invalid');
    // Không chuyển tiếp/phản chiếu tham số của cổng (1.10) — vnp_TxnRef không xuất hiện trong URL đích.
    expect(res.headers.location).not.toContain('vnp_TxnRef');
    expect(res.headers.location).not.toContain('SOMETHING');
  });

  it('GET /payments/mock/pay khi PAYMENT_MOCK_ENABLED tắt (mặc định) — 404, không lộ endpoint dev', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/payments/mock/pay?txnRef=X&amount=1000&sig=Y',
    );

    expect(res.status).toBe(404);
  });

  // ĐÚNG 1 route (route chốt ở 1.14: "GET /payments/mock/pay", 302) xử lý cả 2 nhánh — chưa có
  // `outcome` (trang chọn, 200) và có `outcome` (xử lý + redirect, 302). Bật cờ CHỈ trong khối này,
  // trả lại giá trị cũ ở afterAll — `--runInBand` chạy mọi file *.int-spec.ts trong CÙNG 1 process
  // nên `process.env` rò sang file khác nếu không dọn.
  describe('GET /payments/mock/pay khi PAYMENT_MOCK_ENABLED=true', () => {
    const originalFlag = process.env.PAYMENT_MOCK_ENABLED;
    const provider = new MockPaymentProvider();

    beforeAll(() => {
      process.env.PAYMENT_MOCK_ENABLED = 'true';
    });

    afterAll(() => {
      if (originalFlag === undefined) {
        delete process.env.PAYMENT_MOCK_ENABLED;
      } else {
        process.env.PAYMENT_MOCK_ENABLED = originalFlag;
      }
    });

    async function signedPayPath(txnRef: string): Promise<string> {
      const { payUrl } = await provider.createPayment({
        txnRef,
        amountVnd: 50_000,
        returnUrl: 'http://localhost:4000/api/v1/payments/mock/return',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        locale: 'vi',
      });
      const url = new URL(payUrl);
      return `${url.pathname}${url.search}`;
    }

    it('chưa truyền outcome — 200, trang HTML cho chọn kết quả (mỗi link tự trỏ lại route này)', async () => {
      const path = await signedPayPath('ITMOCKPAY1');

      const res = await request(app.getHttpServer()).get(path);

      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('outcome=SUCCESS');
      expect(res.text).toContain('outcome=FAILED');
    });

    it('outcome=SUCCESS — đi qua confirmPayment thật rồi 302 (txnRef lạ ⇒ error=invalid, nhưng ĐÃ xử lý chứ không phải 200)', async () => {
      const path = await signedPayPath('ITMOCKPAY2');

      const res = await request(app.getHttpServer()).get(
        `${path}&outcome=SUCCESS`,
      );

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/checkout/result');
    });

    // Week10.md 2.3: FE `localeDetection: false` — URL không prefix luôn là tiếng Việt, không còn cookie đưa
    // người mua tiếng Anh về `/en`. Redirect từ cổng thanh toán phải tự mang prefix theo User.locale của người mua.
    // outcome=PENDING đi qua confirmPayment thật nhưng không đổi dữ liệu mà vẫn trả checkoutGroupId.
    describe('redirect về FE mang đúng prefix ngôn ngữ của người mua', () => {
      const prisma = new PrismaClient();

      beforeAll(async () => {
        await cleanupByTag(prisma, TAG);
      });

      afterAll(async () => {
        await cleanupByTag(prisma, TAG);
        await prisma.$disconnect();
      });

      async function redirectFor(locale: UserLocale) {
        const user = await createUser(prisma, TAG, { locale });
        const group = await createCheckoutGroup(prisma, user.id);
        const txnRef = `ITORD${locale.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
        await prisma.payment.create({
          data: {
            checkoutGroupId: group.id,
            method: 'VNPAY',
            amount: 50_000,
            txnRef,
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        });
        const path = await signedPayPath(txnRef);

        const res = await request(app.getHttpServer()).get(
          `${path}&outcome=PENDING`,
        );

        expect(res.status).toBe(302);
        const location = new URL(res.headers.location);
        return {
          groupId: group.id,
          pathname: location.pathname,
          search: location.search,
        };
      }

      it('người mua en — /en/checkout/result?groupId=…', async () => {
        const { groupId, pathname, search } = await redirectFor('en');

        expect(pathname).toBe('/en/checkout/result');
        expect(search).toBe(`?groupId=${groupId}`);
      });

      it('người mua vi — không prefix (/checkout/result?groupId=…)', async () => {
        const { groupId, pathname, search } = await redirectFor('vi');

        expect(pathname).toBe('/checkout/result');
        expect(search).toBe(`?groupId=${groupId}`);
      });
    });

    it('sig sai — 404, không xử lý dù có outcome hợp lệ', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/payments/mock/pay?txnRef=X&amount=50000&sig=bad&outcome=SUCCESS',
      );

      expect(res.status).toBe(404);
    });

    it('outcome không hợp lệ — 404', async () => {
      const path = await signedPayPath('ITMOCKPAY3');

      const res = await request(app.getHttpServer()).get(
        `${path}&outcome=NOT_A_REAL_OUTCOME`,
      );

      expect(res.status).toBe(404);
    });
  });
});
