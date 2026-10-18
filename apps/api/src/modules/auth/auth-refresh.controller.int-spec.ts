import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho POST /auth/refresh (Week10.md 2.1): gia hạn
// phiên hoạt động đúng với token xoay vòng, và khi bị từ chối mà request có gửi cookie refresh_token thì BE
// xoá cả hai cookie phiên (không có cookie ⇒ 401 trơn, không Set-Cookie). Chạy: `pnpm test:int`.
const TAG = 'it-auth-refresh-';
const PASSWORD = 'password123';
const COOKIE_DOMAIN = '.example.test';

const fakeMail = createFakeMail();

describe('POST /auth/refresh (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;
  let savedCookieDomain: string | undefined;

  const raw = () => request(app.getHttpServer());

  function setCookies(res: { headers: Record<string, unknown> }): string[] {
    return (res.headers['set-cookie'] as string[] | undefined) ?? [];
  }

  function cookieOf(res: { headers: Record<string, unknown> }, name: string) {
    const entry = setCookies(res).find((c) => c.startsWith(`${name}=`));
    return entry ? entry.split(';')[0].slice(name.length + 1) : undefined;
  }

  // Dòng Set-Cookie XOÁ cookie: giá trị rỗng + hết hạn năm 1970.
  function clearingEntry(
    res: { headers: Record<string, unknown> },
    name: string,
  ) {
    return setCookies(res).find(
      (c) => c.startsWith(`${name}=;`) && /Expires=Thu, 01 Jan 1970/.test(c),
    );
  }

  async function registerAndLogin() {
    counter += 1;
    const email = `${TAG}${stamp}-${counter}@test.local`;
    await raw()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `Tester ${counter}` })
      .expect(201);
    const login = await raw()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      email,
      accessCookie: cookieOf(login, 'access_token') as string,
      refreshCookie: cookieOf(login, 'refresh_token') as string,
    };
  }

  const refreshWith = (cookies: Record<string, string>) =>
    raw()
      .post('/api/v1/auth/refresh')
      .set(
        'Cookie',
        Object.entries(cookies).map(([name, value]) => `${name}=${value}`),
      );

  beforeAll(async () => {
    // Test này tự kiểm Domain của lệnh xoá cookie ở từng ca, các ca còn lại chạy không có COOKIE_DOMAIN.
    savedCookieDomain = process.env.COOKIE_DOMAIN;
    delete process.env.COOKIE_DOMAIN;
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
    await app.listen(0);
  });

  afterEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  afterAll(async () => {
    if (savedCookieDomain === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = savedCookieDomain;
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await app.close();
  });

  it('refresh token hợp lệ ⇒ 200, cấp CẶP cookie mới (cả hai đều đổi), cookie mới dùng được ngay', async () => {
    const a = await registerAndLogin();

    const res = await refreshWith({ refresh_token: a.refreshCookie }).expect(
      200,
    );

    const newAccess = cookieOf(res, 'access_token');
    const newRefresh = cookieOf(res, 'refresh_token');
    expect(newAccess).toBeTruthy();
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(a.refreshCookie);
    expect(clearingEntry(res, 'access_token')).toBeUndefined();
    await raw()
      .get('/api/v1/auth/me')
      .set('Cookie', [`access_token=${newAccess}`])
      .expect(200);
  });

  it('đủ phiên 15 phút rồi: chỉ còn refresh_token (không có access_token) vẫn gia hạn được', async () => {
    const a = await registerAndLogin();

    // Mô phỏng trình duyệt đã xoá access_token hết hạn: request chỉ mang refresh_token.
    const res = await refreshWith({ refresh_token: a.refreshCookie }).expect(
      200,
    );

    expect(cookieOf(res, 'access_token')).toBeTruthy();
  });

  it('refresh token ĐÃ XOAY (dùng lại token cũ) ⇒ 401 kèm lệnh xoá cả access_token lẫn refresh_token, body đúng format chuẩn', async () => {
    const a = await registerAndLogin();
    await refreshWith({ refresh_token: a.refreshCookie }).expect(200);

    const res = await refreshWith({ refresh_token: a.refreshCookie }).expect(
      401,
    );

    expect(res.body).toMatchObject({ success: false, data: null });
    expect(clearingEntry(res, 'access_token')).toBeDefined();
    expect(clearingEntry(res, 'refresh_token')).toBeDefined();
  });

  it('lệnh xoá mang đúng Path và Domain của cookie đăng nhập (COOKIE_DOMAIN) — lệch là trình duyệt không xoá được', async () => {
    const a = await registerAndLogin();
    await refreshWith({ refresh_token: a.refreshCookie }).expect(200);
    process.env.COOKIE_DOMAIN = COOKIE_DOMAIN;

    const res = await refreshWith({ refresh_token: a.refreshCookie }).expect(
      401,
    );

    for (const name of ['access_token', 'refresh_token']) {
      const entry = clearingEntry(res, name);
      expect(entry).toBeDefined();
      expect(entry).toContain(`Domain=${COOKIE_DOMAIN}`);
      expect(entry).toContain('Path=/');
      expect(entry).toContain('HttpOnly');
      expect(entry).toContain('SameSite=Lax');
    }
  });

  it('KHÔNG có cookie nào ⇒ 401 trơn, KHÔNG có Set-Cookie (request cross-site không mang cookie nên không thể kích hoạt "logout CSRF")', async () => {
    const res = await raw().post('/api/v1/auth/refresh').expect(401);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toMatchObject({ success: false, data: null });
  });

  it('chỉ gửi access_token (không có refresh_token) ⇒ 401 trơn, không xoá cookie nào', async () => {
    const a = await registerAndLogin();

    const res = await refreshWith({ access_token: a.accessCookie }).expect(401);

    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refresh token rác (không phải JWT) ⇒ 401 và vẫn xoá cookie hỏng đó', async () => {
    const res = await refreshWith({ refresh_token: 'khong-phai-jwt' }).expect(
      401,
    );

    expect(clearingEntry(res, 'refresh_token')).toBeDefined();
    expect(clearingEntry(res, 'access_token')).toBeDefined();
  });

  it('sau khi đăng xuất (refresh token bị thu hồi) ⇒ gia hạn bằng cookie cũ bị từ chối và cookie cũ bị xoá', async () => {
    const a = await registerAndLogin();
    await raw()
      .post('/api/v1/auth/logout')
      .set('Cookie', [`access_token=${a.accessCookie}`])
      .expect(200);

    const res = await refreshWith({ refresh_token: a.refreshCookie }).expect(
      401,
    );

    expect(clearingEntry(res, 'refresh_token')).toBeDefined();
  });

  it('trình duyệt (cookie jar) sau lần bị từ chối không còn cookie phiên nào và ĐĂNG NHẬP LẠI được ngay — cookie cũ không khoá người dùng', async () => {
    const a = await registerAndLogin();
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: a.email, password: PASSWORD })
      .expect(200);
    // Đăng nhập lần nữa ở nơi khác làm refresh token của agent bị thay (một cột refreshTokenHash).
    await raw()
      .post('/api/v1/auth/login')
      .send({ email: a.email, password: PASSWORD })
      .expect(200);

    await agent.post('/api/v1/auth/refresh').expect(401);

    // Cookie jar đã nhận lệnh xoá ⇒ không còn phiên nào.
    await agent.get('/api/v1/auth/me').expect(401);
    await agent.post('/api/v1/auth/refresh').expect(401);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: a.email, password: PASSWORD })
      .expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
  });
});
