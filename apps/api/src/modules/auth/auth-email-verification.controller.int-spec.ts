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

// Integration test qua HTTP THẬT (supertest + Postgres thật + MailProvider giả) cho xác thực email
// (Week10.md 2.2): POST /auth/verify-email và POST /auth/resend-verification trả MÃ LỖI máy đọc được
// (VERIFY_TOKEN_INVALID, EMAIL_ALREADY_VERIFIED, VERIFICATION_RESEND_TOO_SOON) để FE dịch theo `code` thay vì
// đọc chuỗi tiếng Việt cứng. Chạy: `pnpm test:int`.
const TAG = 'it-auth-verify-';
const PASSWORD = 'password123';

const fakeMail = createFakeMail();

describe('Xác thực email (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const raw = () => request(app.getHttpServer());

  interface Account {
    email: string;
    userId: string;
    accessCookie: string;
    // Token thô lấy từ mail xác thực lúc đăng ký — đúng thứ người dùng bấm.
    verifyToken: string;
  }

  function cookieOf(res: { headers: Record<string, unknown> }, name: string) {
    const header = res.headers['set-cookie'] as string[] | undefined;
    const entry = header?.find((c) => c.startsWith(`${name}=`));
    return entry ? entry.split(';')[0].slice(name.length + 1) : undefined;
  }

  async function registerAndLogin(): Promise<Account> {
    counter += 1;
    const email = `${TAG}${stamp}-${counter}@test.local`;
    fakeMail.reset();
    await raw()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `Tester ${counter}` })
      .expect(201);
    const mail = fakeMail.sent.find((m) => m.to === email);
    const match = /verify-email\?token=([0-9a-f]{64})/.exec(mail?.html ?? '');
    if (!match) throw new Error('Không thấy link xác thực trong mail đăng ký');
    const login = await raw()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return {
      email,
      userId: user.id,
      accessCookie: cookieOf(login, 'access_token') as string,
      verifyToken: match[1],
    };
  }

  const verify = (token: unknown) =>
    raw().post('/api/v1/auth/verify-email').send({ token });
  const resend = (account: Account) =>
    raw()
      .post('/api/v1/auth/resend-verification')
      .set('Cookie', [`access_token=${account.accessCookie}`]);
  const userRow = (userId: string) =>
    prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const body = (res: { body: unknown }) =>
    res.body as {
      success: boolean;
      data: unknown;
      message: string;
      code?: string;
    };

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
    await app.listen(0);
  });

  beforeEach(() => fakeMail.reset());

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /auth/verify-email', () => {
    it('token trong mail: 200, đánh dấu đã xác thực, xoá token; /auth/me phản ánh ngay', async () => {
      const a = await registerAndLogin();

      await verify(a.verifyToken).expect(200);

      const row = await userRow(a.userId);
      expect(row.emailVerifiedAt).not.toBeNull();
      expect(row.emailVerificationTokenHash).toBeNull();
      expect(row.emailVerificationExpiresAt).toBeNull();
      const me = await raw()
        .get('/api/v1/auth/me')
        .set('Cookie', [`access_token=${a.accessCookie}`])
        .expect(200);
      expect(
        (me.body as { data: { user: { emailVerifiedAt: string | null } } }).data
          .user.emailVerifiedAt,
      ).not.toBeNull();
    });

    it('dùng lại token đã dùng ⇒ 400 VERIFY_TOKEN_INVALID (token chỉ dùng một lần)', async () => {
      const a = await registerAndLogin();
      await verify(a.verifyToken).expect(200);

      const res = await verify(a.verifyToken).expect(400);

      expect(body(res)).toMatchObject({
        success: false,
        data: null,
        code: 'VERIFY_TOKEN_INVALID',
      });
    });

    it('token không tồn tại ⇒ 400 VERIFY_TOKEN_INVALID, message tiếng Anh cho log (FE dịch theo code)', async () => {
      const res = await verify('f'.repeat(64)).expect(400);

      expect(body(res)).toEqual({
        success: false,
        data: null,
        message: 'The email verification link is invalid or has expired',
        code: 'VERIFY_TOKEN_INVALID',
      });
    });

    it('token hết hạn ⇒ CÙNG mã VERIFY_TOKEN_INVALID (không lộ token từng tồn tại) và KHÔNG xác thực', async () => {
      const a = await registerAndLogin();
      await prisma.user.update({
        where: { id: a.userId },
        data: { emailVerificationExpiresAt: new Date(Date.now() - 1000) },
      });

      const res = await verify(a.verifyToken).expect(400);

      expect(body(res).code).toBe('VERIFY_TOKEN_INVALID');
      expect((await userRow(a.userId)).emailVerifiedAt).toBeNull();
    });

    it.each([[undefined], [''], [123]])(
      'token thiếu/rỗng/sai kiểu (%p) ⇒ 400 lỗi validate, KHÔNG có code nghiệp vụ',
      async (token) => {
        const res = await verify(token).expect(400);

        expect(body(res).success).toBe(false);
        expect(body(res).code).toBeUndefined();
      },
    );
  });

  describe('POST /auth/resend-verification', () => {
    it('vừa đăng ký (mail xác thực mới gửi, còn cooldown) ⇒ 429 VERIFICATION_RESEND_TOO_SOON, không gửi thêm mail', async () => {
      const a = await registerAndLogin();
      fakeMail.reset();

      const res = await resend(a).expect(429);

      expect(body(res)).toMatchObject({
        success: false,
        data: null,
        code: 'VERIFICATION_RESEND_TOO_SOON',
      });
      expect(fakeMail.sent).toHaveLength(0);
    });

    it('hết cooldown ⇒ 200 và gửi đúng MỘT mail mới; gọi lại ngay ⇒ 429 VERIFICATION_RESEND_TOO_SOON', async () => {
      const a = await registerAndLogin();
      await prisma.user.update({
        where: { id: a.userId },
        data: { emailVerificationSentAt: new Date(Date.now() - 120_000) },
      });
      fakeMail.reset();

      await resend(a).expect(200);

      expect(fakeMail.sent.filter((m) => m.to === a.email)).toHaveLength(1);
      const again = await resend(a).expect(429);
      expect(body(again).code).toBe('VERIFICATION_RESEND_TOO_SOON');
    });

    it('token của mail gửi lại dùng được, token cũ (từ mail đăng ký) thì không', async () => {
      const a = await registerAndLogin();
      await prisma.user.update({
        where: { id: a.userId },
        data: { emailVerificationSentAt: new Date(Date.now() - 120_000) },
      });
      fakeMail.reset();
      await resend(a).expect(200);
      const mail = fakeMail.sent.find((m) => m.to === a.email);
      const fresh = /verify-email\?token=([0-9a-f]{64})/.exec(
        mail?.html ?? '',
      )?.[1] as string;

      const old = await verify(a.verifyToken).expect(400);
      expect(body(old).code).toBe('VERIFY_TOKEN_INVALID');
      await verify(fresh).expect(200);
    });

    it('đã xác thực rồi ⇒ 400 EMAIL_ALREADY_VERIFIED, không gửi mail', async () => {
      const a = await registerAndLogin();
      await verify(a.verifyToken).expect(200);
      fakeMail.reset();

      const res = await resend(a).expect(400);

      expect(body(res)).toMatchObject({
        success: false,
        data: null,
        code: 'EMAIL_ALREADY_VERIFIED',
      });
      expect(fakeMail.sent).toHaveLength(0);
    });

    it('chưa đăng nhập ⇒ 401, không phải mã nghiệp vụ', async () => {
      const res = await raw()
        .post('/api/v1/auth/resend-verification')
        .expect(401);

      expect(body(res).code).toBeUndefined();
    });
  });
});
