import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AccountStatus, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật + MailProvider giả) cho hồ sơ và mật khẩu
// (Week9.md 1.11/5.4): PATCH /auth/me, POST /auth/change-password, /forgot-password, /reset-password.
// Chứng minh điều unit test với mock không chứng minh được: token chỉ dùng được MỘT lần dưới đồng thời,
// phản hồi của forgot-password giống hệt nhau cho email có/không có tài khoản, refresh token cũ thật sự bị
// từ chối sau khi đổi mật khẩu, và không field nhạy cảm nào lọt vào response. Chạy: `pnpm test:int`.
const TAG = 'it-auth-pw-';
const PASSWORD = 'password123';
const NEW_PASSWORD = 'brand-new-pass-1';

const fakeMail = createFakeMail();

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Hồ sơ và mật khẩu (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const raw = () => request(app.getHttpServer());
  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;

  interface Account {
    agent: Agent;
    userId: string;
    email: string;
    refreshCookie: string;
  }

  const data = (res: { body: unknown }) =>
    (res.body as { data: Record<string, unknown> }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  function cookieOf(res: { headers: Record<string, unknown> }, name: string) {
    const header = res.headers['set-cookie'] as string[] | undefined;
    const entry = header?.find((c) => c.startsWith(`${name}=`));
    return entry ? entry.split(';')[0].slice(name.length + 1) : undefined;
  }

  async function registerAndLogin(
    options: { locale?: 'vi' | 'en' } = {},
  ): Promise<Account> {
    counter += 1;
    const email = `${TAG}${stamp}-${counter}@test.local`;
    const agent = newAgent();
    await agent
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        name: `Tester ${counter}`,
        ...(options.locale ? { locale: options.locale } : {}),
      })
      .expect(201);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    // Đăng ký đã gửi mail xác thực email — bỏ đi để mọi assert về mail trong test chỉ thấy mail của luồng
    // đang kiểm.
    fakeMail.reset();
    return {
      agent,
      userId: user.id,
      email,
      refreshCookie: cookieOf(login, 'refresh_token') as string,
    };
  }

  const userRow = (userId: string) =>
    prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // Mail của forgot-password gửi KHÔNG chờ (chống dò email qua thời gian phản hồi) nên phải đợi nó tới.
  async function waitForMail(to: string, count = 1, timeoutMs = 4000) {
    const started = Date.now();
    while (
      fakeMail.sent.filter((m) => m.to === to).length < count &&
      Date.now() - started < timeoutMs
    ) {
      await sleep(25);
    }
    return fakeMail.sent.filter((m) => m.to === to);
  }

  // Dùng khi khẳng định "KHÔNG có mail": chờ đủ lâu để mail fire-and-forget (nếu có) kịp tới.
  async function mailsAfterSettling(to: string) {
    await sleep(250);
    return fakeMail.sent.filter((m) => m.to === to);
  }

  function resetTokenFrom(html: string): string {
    const match = /reset-password\?token=([0-9a-f]{64})/.exec(html);
    if (!match) throw new Error('Không thấy link đặt lại mật khẩu trong mail');
    return match[1];
  }

  // Yêu cầu link đặt lại và trả về token thô lấy từ mail (đúng thứ người dùng bấm).
  async function requestResetToken(account: Account): Promise<string> {
    await raw()
      .post('/api/v1/auth/forgot-password')
      .send({ email: account.email })
      .expect(200);
    const [mail] = await waitForMail(account.email);
    return resetTokenFrom(mail.html);
  }

  const refreshWith = (refreshCookie: string) =>
    raw()
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshCookie}`]);

  const loginWith = (email: string, password: string) =>
    raw().post('/api/v1/auth/login').send({ email, password });

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

  beforeEach(() => fakeMail.reset());

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await app.close();
  });

  // --- PATCH /auth/me ---------------------------------------------------------------------------

  describe('PATCH /auth/me', () => {
    it('đổi tên và ngôn ngữ email: lưu DB, trả user mới, GET /auth/me phản ánh ngay', async () => {
      const a = await registerAndLogin();

      const res = await a.agent
        .patch('/api/v1/auth/me')
        .send({ name: '  Nguyễn Văn B  ', locale: 'en' })
        .expect(200);

      expect(data(res).user).toMatchObject({
        id: a.userId,
        name: 'Nguyễn Văn B',
        locale: 'en',
        hasPassword: true,
      });
      const row = await userRow(a.userId);
      expect(row).toMatchObject({ name: 'Nguyễn Văn B', locale: 'en' });
      const me = await a.agent.get('/api/v1/auth/me').expect(200);
      expect((data(me).user as { locale: string }).locale).toBe('en');
    });

    it('chỉ gửi locale thì tên giữ nguyên (cập nhật từng phần)', async () => {
      const a = await registerAndLogin();
      const before = await userRow(a.userId);

      await a.agent.patch('/api/v1/auth/me').send({ locale: 'en' }).expect(200);

      const after = await userRow(a.userId);
      expect(after.name).toBe(before.name);
      expect(after.locale).toBe('en');
    });

    it('KHÔNG đổi được email/role/accountStatus/hash/emailVerifiedAt qua body (mass assignment)', async () => {
      const a = await registerAndLogin();
      const before = await userRow(a.userId);

      const res = await a.agent
        .patch('/api/v1/auth/me')
        .send({
          name: 'Tên mới',
          email: 'evil@test.local',
          role: 'ADMIN',
          accountStatus: 'BANNED',
          passwordHash: 'x',
          emailVerifiedAt: '2020-01-01T00:00:00.000Z',
          id: 'another-user-id',
        })
        .expect(200);

      const after = await userRow(a.userId);
      expect(after).toMatchObject({
        id: a.userId,
        name: 'Tên mới',
        email: before.email,
        role: 'USER',
        accountStatus: 'ACTIVE',
        passwordHash: before.passwordHash,
        emailVerifiedAt: before.emailVerifiedAt,
      });
      expect((data(res).user as { role: string }).role).toBe('USER');
    });

    it.each([
      ['body rỗng', {}],
      ['chỉ có field không được phép', { email: 'x@test.local' }],
      ['tên rỗng', { name: '   ' }],
      ['tên chứa thẻ HTML', { name: '<script>alert(1)</script>' }],
      ['tên quá dài', { name: 'a'.repeat(101) }],
      ['ngôn ngữ lạ', { locale: 'fr' }],
    ])('400 khi %s, DB không đổi', async (_label, body) => {
      const a = await registerAndLogin();
      const before = await userRow(a.userId);

      await a.agent.patch('/api/v1/auth/me').send(body).expect(400);

      const after = await userRow(a.userId);
      expect(after.name).toBe(before.name);
      expect(after.locale).toBe(before.locale);
    });

    it('401 khi chưa đăng nhập', async () => {
      await raw().patch('/api/v1/auth/me').send({ name: 'A' }).expect(401);
    });
  });

  // --- POST /auth/change-password ---------------------------------------------------------------

  describe('POST /auth/change-password', () => {
    it('đổi thành công: mật khẩu cũ hết dùng, mới dùng được, phiên hiện tại sống, refresh token cũ chết, đúng MỘT email bảo mật', async () => {
      const a = await registerAndLogin();

      const res = await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // Cặp cookie MỚI được set cho phiên hiện tại, KHÔNG nằm trong body.
      expect(cookieOf(res, 'access_token')).toBeTruthy();
      const newRefresh = cookieOf(res, 'refresh_token');
      expect(newRefresh).toBeTruthy();
      expect(newRefresh).not.toBe(a.refreshCookie);
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);

      await loginWith(a.email, PASSWORD).expect(401);
      await loginWith(a.email, NEW_PASSWORD).expect(200);
      // Phiên hiện tại (cookie mới) vẫn dùng được; refresh token CŨ (thiết bị khác) bị từ chối.
      await a.agent.get('/api/v1/auth/me').expect(200);
      await refreshWith(a.refreshCookie).expect(401);

      const mails = await waitForMail(a.email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Mật khẩu của bạn đã được thay đổi');
      expect(mails[0].html).not.toContain(NEW_PASSWORD);
      expect(mails[0].html).not.toContain(PASSWORD);
    });

    it('email bảo mật theo ngôn ngữ của user (en) và link quên mật khẩu có prefix /en', async () => {
      const a = await registerAndLogin({ locale: 'en' });
      fakeMail.reset();

      await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      const [mail] = await waitForMail(a.email);
      expect(mail.subject).toBe('Your password was changed');
      expect(mail.html).toContain('/en/forgot-password');
    });

    it('sai mật khẩu hiện tại: 400 CURRENT_PASSWORD_INCORRECT, không đổi gì, không gửi mail', async () => {
      const a = await registerAndLogin();
      const before = await userRow(a.userId);

      const res = await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })
        .expect(400);

      expect(code(res)).toBe('CURRENT_PASSWORD_INCORRECT');
      expect((await userRow(a.userId)).passwordHash).toBe(before.passwordHash);
      await loginWith(a.email, PASSWORD).expect(200);
      expect(await mailsAfterSettling(a.email)).toHaveLength(0);
    });

    it('mật khẩu mới trùng mật khẩu cũ / quá ngắn / quá dài theo byte: 400, không đổi', async () => {
      const a = await registerAndLogin();
      const before = await userRow(a.userId);

      for (const newPassword of [PASSWORD, 'short', 'ệ'.repeat(30)]) {
        await a.agent
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: PASSWORD, newPassword })
          .expect(400);
      }

      expect((await userRow(a.userId)).passwordHash).toBe(before.passwordHash);
    });

    it('tài khoản chưa có mật khẩu (chỉ đăng nhập Google): 400 PASSWORD_NOT_SET', async () => {
      const a = await registerAndLogin();
      await prisma.user.update({
        where: { id: a.userId },
        data: { passwordHash: null },
      });

      const res = await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(400);

      expect(code(res)).toBe('PASSWORD_NOT_SET');
      expect((await userRow(a.userId)).passwordHash).toBeNull();
    });

    it('xoá luôn token đặt lại đang chờ (link cũ không dùng để đổi lại mật khẩu vừa đặt)', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      expect((await userRow(a.userId)).passwordResetTokenHash).not.toBeNull();

      await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      const row = await userRow(a.userId);
      expect(row.passwordResetTokenHash).toBeNull();
      expect(row.passwordResetExpiresAt).toBeNull();
      const res = await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'another-pass-77' })
        .expect(400);
      expect(code(res)).toBe('RESET_TOKEN_INVALID');
    });

    it('2 request đổi mật khẩu ĐỒNG THỜI cùng mật khẩu hiện tại: đúng một cái thắng, cái kia 400 (không ghi đè)', async () => {
      const a = await registerAndLogin();
      const other = newAgent();
      // Phiên thứ hai cùng tài khoản.
      await other
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: PASSWORD })
        .expect(200);

      const results = await Promise.all([
        a.agent
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: PASSWORD, newPassword: 'winner-pass-1' }),
        other
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: PASSWORD, newPassword: 'winner-pass-2' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      const loser = results.find((r) => r.status === 400)!;
      expect(code(loser)).toBe('CURRENT_PASSWORD_INCORRECT');
    });

    it('mail lỗi (Resend down) không làm hỏng việc đổi mật khẩu', async () => {
      const a = await registerAndLogin();
      fakeMail.failWith(new Error('Resend down'));

      await a.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      await loginWith(a.email, NEW_PASSWORD).expect(200);
    });

    it('401 khi chưa đăng nhập', async () => {
      await raw()
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });
  });

  // --- POST /auth/forgot-password ---------------------------------------------------------------

  describe('POST /auth/forgot-password', () => {
    it('email có tài khoản: 200, lưu CHỈ hash của token (SHA-256, hạn ~60 phút), gửi đúng một mail có link', async () => {
      const a = await registerAndLogin();

      const res = await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email: a.email })
        .expect(200);

      const mails = await waitForMail(a.email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Đặt lại mật khẩu của bạn');
      expect(mails[0].html).toContain('hết hạn sau 60 phút');
      const token = resetTokenFrom(mails[0].html);

      const row = await userRow(a.userId);
      expect(row.passwordResetTokenHash).toBe(sha256(token));
      expect(row.passwordResetTokenHash).not.toBe(token);
      const ttlMs = row.passwordResetExpiresAt!.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(59 * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60_000);
      expect(row.passwordResetSentAt).not.toBeNull();
      // Response không chứa token hay hash.
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(JSON.stringify(res.body)).not.toContain(sha256(token));
    });

    it('PHẢN HỨNG GIỐNG HỆT NHAU (status + body) cho email có tài khoản, email lạ, tài khoản bị khoá và đang trong cooldown', async () => {
      const existing = await registerAndLogin();
      const suspended = await registerAndLogin();
      await prisma.user.update({
        where: { id: suspended.userId },
        data: { accountStatus: AccountStatus.SUSPENDED },
      });
      const cooling = await registerAndLogin();
      await prisma.user.update({
        where: { id: cooling.userId },
        data: { passwordResetSentAt: new Date() },
      });

      const responses: Array<{ status: number; body: unknown }> = [];
      for (const email of [
        existing.email,
        `${TAG}${stamp}-khong-ton-tai@test.local`,
        suspended.email,
        cooling.email,
      ]) {
        const res = await raw()
          .post('/api/v1/auth/forgot-password')
          .send({ email });
        responses.push({ status: res.status, body: res.body as unknown });
      }

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body).toEqual(responses[0].body);
      }
      // Chỉ tài khoản hợp lệ và không trong cooldown nhận mail.
      await waitForMail(existing.email);
      expect(await mailsAfterSettling(existing.email)).toHaveLength(1);
      expect(await mailsAfterSettling(suspended.email)).toHaveLength(0);
      expect(await mailsAfterSettling(cooling.email)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(1);
    });

    it('cooldown 60 giây: yêu cầu thứ hai ngay sau đó không gửi mail mới và KHÔNG làm token đầu hết hiệu lực', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      const first = await userRow(a.userId);

      await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email: a.email })
        .expect(200);

      expect(await mailsAfterSettling(a.email)).toHaveLength(1);
      expect((await userRow(a.userId)).passwordResetTokenHash).toBe(
        first.passwordResetTokenHash,
      );
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);
    });

    it('sau khi hết cooldown gửi lại được và token MỚI thay thế token cũ', async () => {
      const a = await registerAndLogin();
      const firstToken = await requestResetToken(a);
      await prisma.user.update({
        where: { id: a.userId },
        data: { passwordResetSentAt: new Date(Date.now() - 61_000) },
      });
      fakeMail.reset();

      const secondToken = await requestResetToken(a);

      expect(secondToken).not.toBe(firstToken);
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token: firstToken, newPassword: NEW_PASSWORD })
        .expect(400);
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token: secondToken, newPassword: NEW_PASSWORD })
        .expect(200);
    });

    it('5 request ĐỒNG THỜI cho cùng email: đúng MỘT mail được gửi (cooldown giành bằng UPDATE có điều kiện)', async () => {
      const a = await registerAndLogin();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          raw().post('/api/v1/auth/forgot-password').send({ email: a.email }),
        ),
      );

      expect(results.every((r) => r.status === 200)).toBe(true);
      await waitForMail(a.email);
      expect(await mailsAfterSettling(a.email)).toHaveLength(1);
    });

    it.each([
      AccountStatus.SUSPENDED,
      AccountStatus.BANNED,
      AccountStatus.DEACTIVATED,
    ])(
      'tài khoản %s: không nhận mail và không có token nào được ghi',
      async (accountStatus) => {
        const a = await registerAndLogin();
        await prisma.user.update({
          where: { id: a.userId },
          data: { accountStatus },
        });

        await raw()
          .post('/api/v1/auth/forgot-password')
          .send({ email: a.email })
          .expect(200);

        expect(await mailsAfterSettling(a.email)).toHaveLength(0);
        expect((await userRow(a.userId)).passwordResetTokenHash).toBeNull();
      },
    );

    it('theo ngôn ngữ của user: en ⇒ mail tiếng Anh, link có /en', async () => {
      const a = await registerAndLogin({ locale: 'en' });

      await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email: a.email })
        .expect(200);

      const [mail] = await waitForMail(a.email);
      expect(mail.subject).toBe('Reset your password');
      expect(mail.html).toContain('/en/reset-password?token=');
    });

    it('chuẩn hoá email (hoa/thường, khoảng trắng) như đăng nhập', async () => {
      const a = await registerAndLogin();

      await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email: `  ${a.email.toUpperCase()}  ` })
        .expect(200);

      expect(await waitForMail(a.email)).toHaveLength(1);
    });

    it('mail lỗi (Resend down): vẫn 200 cùng nội dung, token vẫn được ghi (bấm gửi lại sau cooldown)', async () => {
      const a = await registerAndLogin();
      fakeMail.failWith(new Error('Resend down'));

      const res = await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email: a.email })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      await sleep(200);
      expect((await userRow(a.userId)).passwordResetTokenHash).not.toBeNull();
    });

    it.each(['', 'khong-phai-email', 'a@', '@b.co'])(
      '400 khi email không hợp lệ: %p',
      async (email) => {
        await raw()
          .post('/api/v1/auth/forgot-password')
          .send({ email })
          .expect(400);
      },
    );
  });

  // --- POST /auth/reset-password ----------------------------------------------------------------

  describe('POST /auth/reset-password', () => {
    it('token đúng: đổi mật khẩu, thu hồi refresh token cũ, xoá token, gửi đúng một email bảo mật, KHÔNG tự đăng nhập', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      fakeMail.reset();

      const res = await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);

      expect(cookieOf(res, 'access_token')).toBeUndefined();
      expect(cookieOf(res, 'refresh_token')).toBeUndefined();
      // Refresh token cũ phải chết NGAY sau khi đặt lại (kiểm TRƯỚC khi đăng nhập lại, vì đăng nhập mới
      // cũng ghi đè refreshTokenHash và sẽ che mất lỗi nếu reset quên thu hồi phiên).
      await refreshWith(a.refreshCookie).expect(401);
      await loginWith(a.email, PASSWORD).expect(401);
      await loginWith(a.email, NEW_PASSWORD).expect(200);

      const row = await userRow(a.userId);
      expect(row.passwordResetTokenHash).toBeNull();
      expect(row.passwordResetExpiresAt).toBeNull();
      expect(row.passwordResetSentAt).toBeNull();

      const mails = await waitForMail(a.email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe('Mật khẩu của bạn đã được thay đổi');
      expect(mails[0].html).not.toContain(token);
      expect(mails[0].html).not.toContain(NEW_PASSWORD);
    });

    it('DÙNG LẠI token ⇒ 400 RESET_TOKEN_INVALID, mật khẩu không bị ghi đè lần hai', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);

      const res = await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'attacker-pass-9' })
        .expect(400);

      expect(code(res)).toBe('RESET_TOKEN_INVALID');
      await loginWith(a.email, NEW_PASSWORD).expect(200);
      await loginWith(a.email, 'attacker-pass-9').expect(401);
    });

    it('token hết hạn, token lạ và token đã dùng cho CÙNG một phản hồi (không lộ token từng tồn tại hay không)', async () => {
      const expired = await registerAndLogin();
      const expiredToken = await requestResetToken(expired);
      await prisma.user.update({
        where: { id: expired.userId },
        data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
      });
      const used = await registerAndLogin();
      const usedToken = await requestResetToken(used);
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token: usedToken, newPassword: NEW_PASSWORD })
        .expect(200);

      const bodies: unknown[] = [];
      for (const token of [
        expiredToken,
        'f'.repeat(64),
        usedToken,
        'khong-hop-le',
      ]) {
        const res = await raw()
          .post('/api/v1/auth/reset-password')
          .send({ token, newPassword: NEW_PASSWORD })
          .expect(400);
        expect(code(res)).toBe('RESET_TOKEN_INVALID');
        bodies.push(res.body);
      }

      for (const body of bodies) expect(body).toEqual(bodies[0]);
      await loginWith(expired.email, PASSWORD).expect(200); // không đổi
    });

    it('tài khoản bị khoá SAU khi xin link: token vô hiệu, mật khẩu không đổi', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      await prisma.user.update({
        where: { id: a.userId },
        data: { accountStatus: AccountStatus.SUSPENDED },
      });

      const res = await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(400);

      expect(code(res)).toBe('RESET_TOKEN_INVALID');
      const row = await userRow(a.userId);
      expect(row.passwordResetTokenHash).not.toBeNull();
    });

    it('mật khẩu mới không hợp lệ: 400 và token KHÔNG bị tiêu thụ (nhập lại được)', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);

      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'short' })
        .expect(400);
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'ệ'.repeat(30) })
        .expect(400);

      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);
    });

    it('token quá dài bị chặn ở schema (400, không băm chuỗi khổng lồ)', async () => {
      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token: 'a'.repeat(5000), newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('5 request ĐỒNG THỜI cùng token: đúng MỘT cái thành công, các cái còn lại RESET_TOKEN_INVALID', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      fakeMail.reset();

      const results = await Promise.all(
        Array.from({ length: 5 }, (_v, i) =>
          raw()
            .post('/api/v1/auth/reset-password')
            .send({ token, newPassword: `race-winner-pass-${i}` }),
        ),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 400, 400, 400, 400]);
      for (const r of results.filter((x) => x.status === 400)) {
        expect(code(r)).toBe('RESET_TOKEN_INVALID');
      }
      // Một mật khẩu duy nhất có hiệu lực và chỉ một email bảo mật.
      let working = 0;
      for (let i = 0; i < 5; i++) {
        const res = await loginWith(a.email, `race-winner-pass-${i}`);
        if (res.status === 200) working += 1;
      }
      expect(working).toBe(1);
      expect(await waitForMail(a.email)).toHaveLength(1);
    });

    it('tài khoản chỉ đăng nhập Google đặt được mật khẩu ĐẦU TIÊN qua luồng này rồi đăng nhập bằng email/mật khẩu', async () => {
      const a = await registerAndLogin();
      await prisma.user.update({
        where: { id: a.userId },
        data: { passwordHash: null },
      });
      // Chưa có mật khẩu ⇒ không đăng nhập bằng email/mật khẩu được.
      await loginWith(a.email, PASSWORD).expect(401);
      const token = await requestResetToken(a);

      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);

      const login = await loginWith(a.email, NEW_PASSWORD).expect(200);
      expect(data(login).user).toMatchObject({ hasPassword: true });
    });

    it('mail lỗi không làm hỏng việc đặt lại mật khẩu', async () => {
      const a = await registerAndLogin();
      const token = await requestResetToken(a);
      fakeMail.failWith(new Error('Resend down'));

      await raw()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);

      await loginWith(a.email, NEW_PASSWORD).expect(200);
    });
  });

  // --- response không lộ trường nhạy cảm --------------------------------------------------------

  describe('không lộ field nhạy cảm', () => {
    it('register / login / me / PATCH me đều chỉ trả đúng các field của AuthUser', async () => {
      counter += 1;
      const email = `${TAG}${stamp}-leak-${counter}@test.local`;
      const agent = newAgent();
      const register = await agent
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: 'Leak Check' })
        .expect(201);
      const login = await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      // Có token reset đang chờ để chắc chắn cột đó có giá trị thật khi đọc.
      await raw()
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      await waitForMail(email);
      const me = await agent.get('/api/v1/auth/me').expect(200);
      const patched = await agent
        .patch('/api/v1/auth/me')
        .send({ name: 'Leak Check 2' })
        .expect(200);

      for (const res of [register, login, me, patched]) {
        expect(Object.keys(data(res).user as object).sort()).toEqual(
          [
            'email',
            'emailVerifiedAt',
            'hasPassword',
            'id',
            'locale',
            'name',
            'role',
          ].sort(),
        );
        expect(JSON.stringify(res.body)).not.toMatch(/hash/i);
      }
    });
  });
});
