import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';

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
});
