import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type AccountStatus,
  type Prisma,
  type Role,
} from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ADMIN_USER_REASON_MAX_LENGTH,
  adminUserDetailSchema,
  adminUserStatusChangeResponseSchema,
  type AdminUser,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../../shared/realtime/realtime-emitter';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho khoá / cấm / mở lại tài khoản của Admin (Week11.md 3.3).
// Chứng minh điều unit test với mock không chứng minh được: phiên của người bị khoá chết NGAY ở request kế tiếp (access
// token cũ → 401, refresh → 401, đăng nhập → 401), UPDATE có điều kiện thật sự chặn ghi đè khi có người đổi trước, nhật ký
// quản trị rollback cùng thay đổi, và email / ngắt socket lỗi không làm hỏng hành động. Kết nối socket thật (bị ngắt, không
// nối lại được) nằm ở test/admin-user-suspend.e2e-spec.ts. Chạy: `pnpm test:int`.
const TAG = 'it-admin-ustatus-';
const PASSWORD = 'password123';
const REASON = 'Vi phạm điều khoản sử dụng';
const CANARY_REASON = `Gian lận thanh toán CANARY-REASON-${Date.now()}`;

describe('AdminUser suspend / reactivate (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const fakeMail = createFakeMail();
  const stamp = Date.now();
  const P = `${TAG}${stamp}-`;
  let seq = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let secondAdmin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;
  let secondAdminId: string;

  const observed = {
    suspend: new Set<number>(),
    reactivate: new Set<number>(),
  };

  const suspendRaw = async (agent: Agent, id: string, body?: unknown) => {
    const req = agent.post(`/api/v1/admin/users/${id}/suspend`);
    const res = await (body === undefined
      ? req.send()
      : req.send(body as object));
    observed.suspend.add(res.status);
    return res;
  };
  const reactivateRaw = async (agent: Agent, id: string, body?: unknown) => {
    const req = agent.post(`/api/v1/admin/users/${id}/reactivate`);
    const res = await (body === undefined
      ? req.send()
      : req.send(body as object));
    observed.reactivate.add(res.status);
    return res;
  };
  const suspend = (
    id: string,
    status: 'SUSPENDED' | 'BANNED' = 'SUSPENDED',
    reason = REASON,
    agent: Agent = admin,
  ) => suspendRaw(agent, id, { status, reason });
  const reactivate = (id: string, reason = REASON, agent: Agent = admin) =>
    reactivateRaw(agent, id, { reason });

  const userOf = (res: { body: unknown }) =>
    (res.body as { data: { user: AdminUser } }).data.user;
  const codeOf = (res: { body: unknown }) =>
    (res.body as { code?: string }).code;

  async function login(agent: Agent, email: string) {
    return agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  }

  interface SeedUser {
    status?: AccountStatus;
    role?: Role;
    locale?: 'vi' | 'en';
    statusReason?: string | null;
    name?: string;
  }
  async function seedUser(input: SeedUser = {}) {
    const email = `${P}${seq++}@test.local`;
    const row = await prisma.user.create({
      data: {
        email,
        name: input.name ?? 'Nguyễn Văn An',
        role: input.role ?? 'USER',
        accountStatus: input.status ?? 'ACTIVE',
        locale: input.locale ?? 'vi',
        statusReason: input.statusReason ?? null,
        statusChangedAt: input.statusReason ? new Date('2026-01-01') : null,
        emailVerifiedAt: new Date(),
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      },
      select: { id: true },
    });
    return { id: row.id, email };
  }
  const readUser = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        accountStatus: true,
        statusReason: true,
        statusChangedAt: true,
        refreshTokenHash: true,
        role: true,
      },
    });
  const auditRows = (id: string) =>
    prisma.adminAuditLog.findMany({
      where: { targetType: 'USER', targetId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): test đua bắn nhiều request song song.
    await app.listen(0);

    const makeAdmin = async (label: string) => {
      const email = `${P}${label}@test.local`;
      await seedAdmin(prisma, { email, password: PASSWORD });
      const agent = newAgent();
      await login(agent, email).then((res) => expect(res.status).toBe(200));
      const row = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });
      return { agent, id: row.id };
    };
    const first = await makeAdmin('admin1');
    const second = await makeAdmin('admin2');
    admin = first.agent;
    adminId = first.id;
    secondAdmin = second.agent;
    secondAdminId = second.id;

    plainUser = newAgent();
    const plainEmail = `${P}plain@test.local`;
    await plainUser
      .post('/api/v1/auth/register')
      .send({ email: plainEmail, password: PASSWORD, name: `${TAG}plain` })
      .expect(201);
    await login(plainUser, plainEmail).then((res) =>
      expect(res.status).toBe(200),
    );
    anonymous = newAgent();
  });

  beforeEach(() => {
    fakeMail.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SUPPORT_EMAIL;
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // --- Quyền truy cập ----------------------------------------------------------------------------

  describe('quyền truy cập (RolesGuard thật)', () => {
    it('khách ⇒ 401, user thường ⇒ 403, ở cả hai route; người dùng không đổi', async () => {
      const target = await seedUser();

      for (const agent of [anonymous, plainUser]) {
        const expected = agent === anonymous ? 401 : 403;
        expect(
          (await suspend(target.id, 'SUSPENDED', REASON, agent)).status,
        ).toBe(expected);
        expect((await reactivate(target.id, REASON, agent)).status).toBe(
          expected,
        );
      }

      expect(await readUser(target.id)).toMatchObject({
        accountStatus: 'ACTIVE',
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      });
      expect(await auditRows(target.id)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(0);
    });
  });

  // --- Khoá / cấm --------------------------------------------------------------------------------

  describe('khoá / cấm', () => {
    it('ACTIVE → SUSPENDED: response đúng hợp đồng, DB đổi, phiên bị thu hồi, có nhật ký', async () => {
      const target = await seedUser();
      const before = Date.now();

      const res = await suspend(target.id, 'SUSPENDED', REASON);

      expect(res.status).toBe(200);
      const parsed = adminUserStatusChangeResponseSchema.parse(
        (res.body as { data: unknown }).data,
      );
      expect(parsed.user).toMatchObject({
        id: target.id,
        accountStatus: 'SUSPENDED',
        statusReason: REASON,
      });
      // Allowlist: đúng chín trường, không lộ gì thêm.
      expect(Object.keys(userOf(res)).sort()).toEqual([
        'accountStatus',
        'createdAt',
        'email',
        'id',
        'isEmailVerified',
        'name',
        'role',
        'statusChangedAt',
        'statusReason',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('CANARY-REFRESH');

      const row = await readUser(target.id);
      expect(row).toMatchObject({
        accountStatus: 'SUSPENDED',
        statusReason: REASON,
        refreshTokenHash: null,
      });
      expect(row.statusChangedAt?.getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    it('nhật ký quản trị: một dòng SUSPEND_USER đúng người làm / đối tượng / hướng đổi / lý do / IP', async () => {
      const target = await seedUser();

      // supertest không tự gửi User-Agent, nên đặt tường minh để kiểm dấu vết "từ đâu" của nhật ký.
      const res = await admin
        .post(`/api/v1/admin/users/${target.id}/suspend`)
        .set('User-Agent', 'IntTest/1.0 (audit)')
        .send({ status: 'BANNED', reason: REASON });
      observed.suspend.add(res.status);

      const rows = await auditRows(target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: adminId,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId: target.id,
        reason: REASON,
        meta: { from: 'ACTIVE', to: 'BANNED' },
      });
      // supertest nối qua loopback: IPv4 (đã bỏ tiền tố ::ffff:) hoặc IPv6.
      expect(rows[0].ip).toMatch(/^(127\.0\.0\.1|::1)$/);
      expect(rows[0].userAgent).toBe('IntTest/1.0 (audit)');
    });

    it('ACTIVE → BANNED và SUSPENDED → BANNED (nâng mức): lý do mới thay lý do cũ, nhật ký ghi hướng thật', async () => {
      const banned = await seedUser();
      expect((await suspend(banned.id, 'BANNED', 'Cấm thẳng')).status).toBe(
        200,
      );
      expect(await readUser(banned.id)).toMatchObject({
        accountStatus: 'BANNED',
        statusReason: 'Cấm thẳng',
      });

      const escalated = await seedUser({
        status: 'SUSPENDED',
        statusReason: 'Tạm khoá trước đó',
      });
      expect(
        (await suspend(escalated.id, 'BANNED', 'Nâng lên cấm')).status,
      ).toBe(200);
      expect(await readUser(escalated.id)).toMatchObject({
        accountStatus: 'BANNED',
        statusReason: 'Nâng lên cấm',
        refreshTokenHash: null,
      });
      expect((await auditRows(escalated.id))[0].meta).toEqual({
        from: 'SUSPENDED',
        to: 'BANNED',
      });
    });

    it('lý do dài đúng trần được lưu; CRLF được chuẩn hoá về LF ở cả cột lẫn nhật ký', async () => {
      const longReason = 'a'.repeat(ADMIN_USER_REASON_MAX_LENGTH);
      const first = await seedUser();
      expect((await suspend(first.id, 'SUSPENDED', longReason)).status).toBe(
        200,
      );
      expect((await readUser(first.id)).statusReason).toBe(longReason);

      const second = await seedUser();
      await suspend(second.id, 'SUSPENDED', '  Dòng 1\r\nDòng 2\rDòng 3  ');
      expect((await readUser(second.id)).statusReason).toBe(
        'Dòng 1\nDòng 2\nDòng 3',
      );
      expect((await auditRows(second.id))[0].reason).toBe(
        'Dòng 1\nDòng 2\nDòng 3',
      );
    });

    it('chi tiết người dùng hiện dòng nhật ký vừa ghi, kèm tên Admin', async () => {
      const target = await seedUser();
      await suspend(target.id, 'SUSPENDED', REASON);

      const res = await admin.get(`/api/v1/admin/users/${target.id}`);

      const detail = adminUserDetailSchema.parse(
        (res.body as { data: unknown }).data,
      );
      expect(detail.accountStatus).toBe('SUSPENDED');
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0]).toMatchObject({
        action: 'SUSPEND_USER',
        actorId: adminId,
        reason: REASON,
        meta: { from: 'ACTIVE', to: 'SUSPENDED' },
      });
      expect(detail.history[0].actorName).toBeTruthy();
    });
  });

  // --- Hiệu lực tức thì lên phiên ----------------------------------------------------------------

  describe('phiên của người bị khoá chết ngay', () => {
    it('access token cũ ⇒ 401 ACCOUNT_NOT_ACTIVE ở request kế tiếp, refresh ⇒ 401, đăng nhập mới ⇒ 401; mở lại thì đăng nhập được ngay', async () => {
      const email = `${P}session@test.local`;
      await anonymous
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: `${TAG}session` })
        .expect(201);
      const session = newAgent();
      expect((await login(session, email)).status).toBe(200);
      expect((await session.get('/api/v1/auth/me')).status).toBe(200);
      const { id } = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });
      expect((await readUser(id)).refreshTokenHash).not.toBeNull();

      expect((await suspend(id, 'SUSPENDED')).status).toBe(200);

      // Cookie access_token cũ vẫn còn hạn nhưng JwtStrategy đọc lại accountStatus ở MỌI request.
      const me = await session.get('/api/v1/auth/me');
      expect(me.status).toBe(401);
      expect(codeOf(me)).toBe('ACCOUNT_NOT_ACTIVE');
      // Refresh token đã bị thu hồi.
      expect((await session.post('/api/v1/auth/refresh')).status).toBe(401);
      // Đăng nhập mới với đúng mật khẩu cũng bị từ chối, kèm mã để FE hiện đúng thông báo.
      const relogin = await login(newAgent(), email);
      expect(relogin.status).toBe(401);
      expect(codeOf(relogin)).toBe('ACCOUNT_NOT_ACTIVE');

      expect((await reactivate(id)).status).toBe(200);
      const back = newAgent();
      expect((await login(back, email)).status).toBe(200);
      expect((await back.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('cấm (BANNED) cũng chặn đăng nhập; mở lại từ BANNED đăng nhập được', async () => {
      const email = `${P}banned-login@test.local`;
      await anonymous
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, name: `${TAG}banned-login` })
        .expect(201);
      const { id } = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });

      expect((await suspend(id, 'BANNED')).status).toBe(200);
      const blocked = await login(newAgent(), email);
      expect([blocked.status, codeOf(blocked)]).toEqual([
        401,
        'ACCOUNT_NOT_ACTIVE',
      ]);

      expect((await reactivate(id)).status).toBe(200);
      expect((await login(newAgent(), email)).status).toBe(200);
    });
  });

  // --- Mở lại ------------------------------------------------------------------------------------

  describe('mở lại', () => {
    it.each(['SUSPENDED', 'BANNED'] as const)(
      '%s → ACTIVE: xoá lý do khoá, đổi mốc, giữ refresh token đã thu hồi, ghi REACTIVATE_USER',
      async (from) => {
        const target = await seedUser({
          status: from,
          statusReason: 'Lý do khoá cũ',
        });
        await prisma.user.update({
          where: { id: target.id },
          data: { refreshTokenHash: null },
        });
        const before = await readUser(target.id);

        const res = await reactivate(target.id, 'Khiếu nại được chấp nhận');

        expect(res.status).toBe(200);
        expect(userOf(res)).toMatchObject({
          accountStatus: 'ACTIVE',
          statusReason: null,
        });
        const row = await readUser(target.id);
        expect(row).toMatchObject({
          accountStatus: 'ACTIVE',
          statusReason: null,
          refreshTokenHash: null,
        });
        expect(row.statusChangedAt?.getTime()).toBeGreaterThan(
          before.statusChangedAt?.getTime() ?? 0,
        );
        const rows = await auditRows(target.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          actorId: adminId,
          action: 'REACTIVATE_USER',
          reason: 'Khiếu nại được chấp nhận',
          meta: { from, to: 'ACTIVE' },
        });
      },
    );

    it('khoá rồi mở: hai dòng nhật ký đúng thứ tự, lịch sử trong chi tiết có cả hai', async () => {
      const target = await seedUser();
      await suspend(target.id, 'SUSPENDED', 'Khoá');
      await reactivate(target.id, 'Mở');

      const res = await admin.get(`/api/v1/admin/users/${target.id}`);
      const { history } = adminUserDetailSchema.parse(
        (res.body as { data: unknown }).data,
      );

      expect(history.map((h) => h.action)).toEqual([
        'REACTIVATE_USER',
        'SUSPEND_USER',
      ]);
      expect(history.map((h) => h.reason)).toEqual(['Mở', 'Khoá']);
    });
  });

  // --- Cạnh không hợp lệ -------------------------------------------------------------------------

  describe('bảng chuyển trạng thái áp qua HTTP (12 tổ hợp)', () => {
    // Bảng đối chiếu viết tay, độc lập với `ADMIN_ACCOUNT_STATUS_TRANSITIONS`.
    const ALLOWED: Record<AccountStatus, AccountStatus[]> = {
      ACTIVE: ['SUSPENDED', 'BANNED'],
      SUSPENDED: ['BANNED', 'ACTIVE'],
      BANNED: ['ACTIVE'],
      DEACTIVATED: [],
    };
    const FROM: AccountStatus[] = [
      'ACTIVE',
      'SUSPENDED',
      'BANNED',
      'DEACTIVATED',
    ];
    const TO = ['SUSPENDED', 'BANNED', 'ACTIVE'] as const;
    const cases = FROM.flatMap((from) => TO.map((to) => [from, to] as const));

    it.each(cases)('%s → %s', async (from, to) => {
      const target = await seedUser({
        status: from,
        statusReason: from === 'ACTIVE' ? null : 'Lý do cũ',
      });
      const before = await readUser(target.id);

      const res =
        to === 'ACTIVE'
          ? await reactivate(target.id)
          : await suspend(target.id, to);

      if (ALLOWED[from].includes(to)) {
        expect(res.status).toBe(200);
        expect((await readUser(target.id)).accountStatus).toBe(to);
        expect(await auditRows(target.id)).toHaveLength(1);
      } else {
        expect(res.status).toBe(409);
        expect(codeOf(res)).toBe('USER_INVALID_TRANSITION');
        // Không ghi gì: dòng người dùng y nguyên, không nhật ký, không email.
        expect(await readUser(target.id)).toEqual(before);
        expect(await auditRows(target.id)).toHaveLength(0);
        expect(fakeMail.sent).toHaveLength(0);
      }
    });
  });

  describe('Admin và chính mình', () => {
    it('khoá / cấm / mở lại một Admin khác ⇒ 409 CANNOT_MODIFY_ADMIN, không đổi gì', async () => {
      for (const status of ['SUSPENDED', 'BANNED'] as const) {
        const res = await suspend(secondAdminId, status);
        expect([res.status, codeOf(res)]).toEqual([409, 'CANNOT_MODIFY_ADMIN']);
      }
      const res = await reactivate(secondAdminId);
      expect([res.status, codeOf(res)]).toEqual([409, 'CANNOT_MODIFY_ADMIN']);

      expect(await readUser(secondAdminId)).toMatchObject({
        accountStatus: 'ACTIVE',
        role: 'ADMIN',
      });
      expect(await auditRows(secondAdminId)).toHaveLength(0);
    });

    it('tự khoá / tự mở chính mình ⇒ 409 CANNOT_MODIFY_SELF (không bị che bởi CANNOT_MODIFY_ADMIN)', async () => {
      const suspended = await suspend(adminId, 'BANNED');
      const reactivated = await reactivate(adminId);

      expect([suspended.status, codeOf(suspended)]).toEqual([
        409,
        'CANNOT_MODIFY_SELF',
      ]);
      expect([reactivated.status, codeOf(reactivated)]).toEqual([
        409,
        'CANNOT_MODIFY_SELF',
      ]);
      expect((await readUser(adminId)).accountStatus).toBe('ACTIVE');
      // Phiên của Admin vẫn dùng được.
      expect((await admin.get('/api/v1/auth/me')).status).toBe(200);
    });
  });

  // --- Id và body không hợp lệ -------------------------------------------------------------------

  describe('id không tồn tại hoặc sai dạng', () => {
    const UNKNOWN = '00000000-0000-4000-8000-000000000000';

    it('id không có thật ⇒ 404 USER_NOT_FOUND ở cả hai route', async () => {
      const a = await suspend(UNKNOWN);
      const b = await reactivate(UNKNOWN);

      expect([a.status, codeOf(a)]).toEqual([404, 'USER_NOT_FOUND']);
      expect([b.status, codeOf(b)]).toEqual([404, 'USER_NOT_FOUND']);
    });

    it.each([
      ['chuỗi tuỳ ý', 'abc'],
      ['có ký tự NUL', `${UNKNOWN}%00`],
      ['dấu nháy SQL', "1'%20OR%20'1'='1"],
    ])(
      'id %s ⇒ CÙNG status và body với id không tồn tại (không có oracle)',
      async (_name, id) => {
        const unknown = await suspend(UNKNOWN);
        const res = await suspend(id);

        expect(res.status).toBe(404);
        expect(res.body).toEqual(unknown.body);
      },
    );
  });

  describe('body không hợp lệ ⇒ 400, người dùng không đổi', () => {
    it.each([
      ['không có body', undefined],
      ['body rỗng', {}],
      ['thiếu lý do', { status: 'SUSPENDED' }],
      ['lý do rỗng', { status: 'SUSPENDED', reason: '' }],
      ['lý do toàn khoảng trắng', { status: 'SUSPENDED', reason: ' \n ' }],
      ['lý do quá dài', { status: 'SUSPENDED', reason: 'a'.repeat(501) }],
      [
        'lý do có ký tự NUL',
        { status: 'SUSPENDED', reason: `a${String.fromCharCode(0)}b` },
      ],
      ['lý do không phải chuỗi', { status: 'SUSPENDED', reason: 42 }],
      ['thiếu status', { reason: REASON }],
      [
        'status ACTIVE (mở lại có endpoint riêng)',
        { status: 'ACTIVE', reason: REASON },
      ],
      ['status DEACTIVATED', { status: 'DEACTIVATED', reason: REASON }],
      ['status viết thường', { status: 'banned', reason: REASON }],
    ])('suspend: %s', async (_name, body) => {
      const target = await seedUser();

      const res = await suspendRaw(admin, target.id, body);

      expect(res.status).toBe(400);
      expect(await readUser(target.id)).toMatchObject({
        accountStatus: 'ACTIVE',
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      });
      expect(await auditRows(target.id)).toHaveLength(0);
    });

    it.each([
      ['không có body', undefined],
      ['thiếu lý do', {}],
      ['lý do rỗng', { reason: '' }],
      ['lý do quá dài', { reason: 'a'.repeat(501) }],
    ])('reactivate: %s', async (_name, body) => {
      const target = await seedUser({
        status: 'SUSPENDED',
        statusReason: 'Cũ',
      });

      const res = await reactivateRaw(admin, target.id, body);

      expect(res.status).toBe(400);
      expect(await readUser(target.id)).toMatchObject({
        accountStatus: 'SUSPENDED',
        statusReason: 'Cũ',
      });
    });

    it('khoá lạ trong body (role, userId, accountStatus) bị bỏ qua: không thay đổi được gì ngoài status + reason', async () => {
      const target = await seedUser();

      const res = await suspendRaw(admin, target.id, {
        status: 'SUSPENDED',
        reason: REASON,
        role: 'ADMIN',
        id: secondAdminId,
        accountStatus: 'ACTIVE',
      });

      expect(res.status).toBe(200);
      expect(await readUser(target.id)).toMatchObject({
        role: 'USER',
        accountStatus: 'SUSPENDED',
      });
      expect(await readUser(secondAdminId)).toMatchObject({
        accountStatus: 'ACTIVE',
      });
    });
  });

  // --- Đua nhau ----------------------------------------------------------------------------------

  describe('hai Admin thao tác cùng lúc', () => {
    // Chờ cho tới khi ĐỦ `count` câu UPDATE trên bảng users đang bị chặn bởi khoá hàng — điều kiện thật thay vì ngủ cố định.
    async function untilBlockedUpdates(count: number) {
      for (let attempt = 0; attempt < 250; attempt++) {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE "public"."users"%'`;
        if (Number(rows[0].n) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('các UPDATE không bị chặn như dự kiến');
    }

    // Giữ khoá hàng của người dùng trong MỘT transaction của test, chạy `whileHeld` (nơi bắn các request), rồi mới đổi trạng
    // thái trong transaction đó và thả khoá. Mọi request đã ĐỌC trạng thái cũ (ACTIVE) và đang chờ ở UPDATE.
    async function raceAgainstEarlierWriter(
      id: string,
      whileHeld: () => Promise<unknown>,
      winner: Prisma.UserUpdateInput,
    ) {
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));

      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
          locked();
          await gate;
          await tx.user.update({ where: { id }, data: winner });
        },
        { timeout: 30_000 },
      );
      await lockTaken;
      const requests = whileHeld();
      return { holder, requests, release };
    }

    it('một người khác đổi trạng thái giữa lúc đọc và ghi ⇒ CẢ HAI request nhận 409, KHÔNG ai ghi đè, không nhật ký, không email', async () => {
      const target = await seedUser();

      const { holder, requests, release } = await raceAgainstEarlierWriter(
        target.id,
        () =>
          Promise.all([
            suspend(target.id, 'SUSPENDED', 'Admin 1 muốn tạm khoá', admin),
            suspend(target.id, 'BANNED', 'Admin 2 muốn cấm', secondAdmin),
          ]),
        {
          accountStatus: 'SUSPENDED',
          statusReason: 'Người thắng trước',
          statusChangedAt: new Date('2026-02-02T00:00:00.000Z'),
        },
      );
      await untilBlockedUpdates(2);
      release();
      await holder;
      const [first, second] = (await requests) as [
        { status: number; body: unknown },
        { status: number; body: unknown },
      ];

      expect([first.status, second.status]).toEqual([409, 409]);
      expect([codeOf(first), codeOf(second)]).toEqual([
        'USER_INVALID_TRANSITION',
        'USER_INVALID_TRANSITION',
      ]);
      // Lý do và mốc của người thắng trước còn nguyên.
      expect(await readUser(target.id)).toMatchObject({
        accountStatus: 'SUSPENDED',
        statusReason: 'Người thắng trước',
      });
      expect((await readUser(target.id)).statusChangedAt?.toISOString()).toBe(
        '2026-02-02T00:00:00.000Z',
      );
      expect(await auditRows(target.id)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(0);
    });

    // Điều kiện vai `USER` trong WHERE của UPDATE là lớp phòng thủ thứ hai sau bước kiểm vai lúc đọc: hôm nay không có mã nào
    // đổi vai, nhưng nếu một ngày có (hoặc DB bị sửa tay) giữa lúc Admin đọc và ghi thì một Admin không được lọt vào luồng khoá.
    it('người dùng được nâng thành Admin giữa lúc đọc và ghi ⇒ CẢ HAI request nhận 409, Admin KHÔNG bị khoá, phiên còn nguyên', async () => {
      const target = await seedUser();

      const { holder, requests, release } = await raceAgainstEarlierWriter(
        target.id,
        () =>
          Promise.all([
            suspend(target.id, 'SUSPENDED', 'Admin 1 muốn tạm khoá', admin),
            suspend(target.id, 'BANNED', 'Admin 2 muốn cấm', secondAdmin),
          ]),
        { role: 'ADMIN' },
      );
      await untilBlockedUpdates(2);
      release();
      await holder;
      const [first, second] = (await requests) as [
        { status: number; body: unknown },
        { status: number; body: unknown },
      ];

      expect([first.status, second.status]).toEqual([409, 409]);
      expect(await readUser(target.id)).toMatchObject({
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        statusReason: null,
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      });
      expect(await auditRows(target.id)).toHaveLength(0);
      expect(fakeMail.sent).toHaveLength(0);
    });

    it.each([
      ['hai Admin cùng tạm khoá', 'SUSPENDED', 'SUSPENDED'],
      ['một tạm khoá, một cấm', 'SUSPENDED', 'BANNED'],
    ] as const)(
      '%s trên người đang ACTIVE: đúng một bên thắng, một nhật ký, một email (5 vòng)',
      async (_name, statusA, statusB) => {
        for (let round = 0; round < 5; round++) {
          fakeMail.reset();
          const target = await seedUser();

          const [a, b] = await Promise.all([
            suspend(target.id, statusA, 'Lý do của Admin 1', admin),
            suspend(target.id, statusB, 'Lý do của Admin 2', secondAdmin),
          ]);

          expect([a.status, b.status].sort()).toEqual([200, 409]);
          const winner = a.status === 200 ? a : b;
          const loser = a.status === 200 ? b : a;
          expect(codeOf(loser)).toBe('USER_INVALID_TRANSITION');
          const rows = await auditRows(target.id);
          expect(rows).toHaveLength(1);
          const final = await readUser(target.id);
          expect(final.accountStatus).toBe(userOf(winner).accountStatus);
          expect(rows[0].meta).toEqual({
            from: 'ACTIVE',
            to: final.accountStatus,
          });
          expect(rows[0].actorId).toBe(winner === a ? adminId : secondAdminId);
          expect(final.statusReason).toBe(rows[0].reason);
          expect(fakeMail.sent).toHaveLength(1);
        }
      },
    );

    it('hai Admin cùng mở lại: đúng một bên thắng, một nhật ký REACTIVATE_USER', async () => {
      const target = await seedUser({
        status: 'SUSPENDED',
        statusReason: 'Cũ',
      });

      const [a, b] = await Promise.all([
        reactivate(target.id, 'Mở bởi 1', admin),
        reactivate(target.id, 'Mở bởi 2', secondAdmin),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const rows = await auditRows(target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('REACTIVATE_USER');
    });
  });

  // --- Nhật ký là một phần của hành động ---------------------------------------------------------

  describe('nhật ký quản trị cùng transaction với việc khoá', () => {
    it('ghi nhật ký lỗi ⇒ 500 và tài khoản KHÔNG bị khoá: trạng thái, phiên đều nguyên, không email, không ngắt socket', async () => {
      const target = await seedUser();
      jest
        .spyOn(app.get(AdminAuditService, { strict: false }), 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      const disconnect = jest.spyOn(
        app.get<RealtimeEmitter>(REALTIME_EMITTER, { strict: false }),
        'disconnectUser',
      );

      // Gọi thẳng, không qua `suspend()`: 500 ở đây là điều ta CỐ Ý gây ra, không phải một status route phải khai báo.
      const res = await admin
        .post(`/api/v1/admin/users/${target.id}/suspend`)
        .send({ status: 'SUSPENDED', reason: CANARY_REASON });

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('CANARY-REASON');
      expect(await readUser(target.id)).toMatchObject({
        accountStatus: 'ACTIVE',
        statusReason: null,
        refreshTokenHash: 'CANARY-REFRESH-HASH',
      });
      expect(fakeMail.sent).toHaveLength(0);
      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  // --- Side-effect sau commit --------------------------------------------------------------------

  describe('email và ngắt socket sau commit', () => {
    it('khoá: gửi đúng MỘT email tới chính chủ, theo ngôn ngữ của họ, kèm lý do, không có link', async () => {
      const vi = await seedUser({ locale: 'vi', name: 'Nguyễn Văn An' });
      const en = await seedUser({ locale: 'en', name: 'John' });

      await suspend(vi.id, 'SUSPENDED', 'Lý do tiếng Việt');
      await suspend(en.id, 'BANNED', 'English reason');

      expect(fakeMail.sent).toHaveLength(2);
      const [viMail, enMail] = fakeMail.sent;
      expect(viMail.to).toBe(vi.email);
      expect(viMail.subject).toBe('Tài khoản của bạn đã bị tạm khoá');
      expect(viMail.html).toContain('Lý do tiếng Việt');
      expect(viMail.html).not.toMatch(/href=/i);
      expect(enMail.to).toBe(en.email);
      expect(enMail.subject).toBe('Your account has been banned');
      expect(enMail.html).toContain('English reason');
      // Bản tiếng Anh không lẫn chữ Việt.
      expect(enMail.subject + enMail.html).not.toMatch(
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i,
      );
    });

    it('mở lại: email có nút Đăng nhập đúng prefix ngôn ngữ', async () => {
      const en = await seedUser({
        locale: 'en',
        status: 'SUSPENDED',
        statusReason: 'Cũ',
      });

      await reactivate(en.id, 'Appeal accepted');

      expect(fakeMail.sent).toHaveLength(1);
      expect(fakeMail.sent[0].subject).toBe('Your account has been reinstated');
      const hrefs = [...fakeMail.sent[0].html.matchAll(/href="([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(hrefs).toHaveLength(1);
      expect(hrefs[0]).toMatch(/\/en\/login$/);
    });

    it('lý do chứa HTML bị escape trong email', async () => {
      const target = await seedUser();

      await suspend(target.id, 'SUSPENDED', '<script>alert(1)</script>');

      expect(fakeMail.sent[0].html).not.toContain('<script>');
      expect(fakeMail.sent[0].html).toContain('&lt;script&gt;');
    });

    it('SUPPORT_EMAIL đặt ⇒ email khoá có dòng hỗ trợ; không đặt ⇒ không có', async () => {
      const without = await seedUser();
      await suspend(without.id);
      expect(fakeMail.sent[0].html).not.toMatch(/Liên hệ hỗ trợ/);

      fakeMail.reset();
      process.env.SUPPORT_EMAIL = 'help@example.com';
      const withSupport = await seedUser();
      await suspend(withSupport.id);
      expect(fakeMail.sent[0].html).toContain('Liên hệ hỗ trợ');
      expect(fakeMail.sent[0].html).toContain('help@example.com');

      // Email MỞ LẠI không có dòng hỗ trợ dù đã cấu hình: chỉ người đang bị khoá cần đường phản hồi.
      fakeMail.reset();
      await reactivate(withSupport.id);
      expect(fakeMail.sent).toHaveLength(1);
      expect(fakeMail.sent[0].html).not.toContain('help@example.com');
    });

    it('nhà cung cấp email lỗi ⇒ vẫn 200 và tài khoản vẫn bị khoá, lỗi chỉ được log', async () => {
      const target = await seedUser();
      fakeMail.failWith(new Error('resend 500'));
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const res = await suspend(target.id, 'SUSPENDED', CANARY_REASON);

      expect(res.status).toBe(200);
      expect((await readUser(target.id)).accountStatus).toBe('SUSPENDED');
      expect(await auditRows(target.id)).toHaveLength(1);
      expect(errorLog).toHaveBeenCalled();
    });

    it('ngắt socket lỗi ⇒ vẫn 200, vẫn gửi email', async () => {
      const target = await seedUser();
      jest
        .spyOn(
          app.get<RealtimeEmitter>(REALTIME_EMITTER, { strict: false }),
          'disconnectUser',
        )
        .mockRejectedValueOnce(new Error('ws down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const res = await suspend(target.id);

      expect(res.status).toBe(200);
      expect(fakeMail.sent).toHaveLength(1);
    });

    it('khoá / cấm gọi disconnectUser đúng người; mở lại thì KHÔNG', async () => {
      const disconnect = jest.spyOn(
        app.get<RealtimeEmitter>(REALTIME_EMITTER, { strict: false }),
        'disconnectUser',
      );
      const target = await seedUser();

      await suspend(target.id, 'SUSPENDED');
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledWith(target.id);

      disconnect.mockClear();
      await reactivate(target.id);
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('lý do (văn bản Admin nhập) và email người nhận KHÔNG xuất hiện trong bất kỳ dòng log nào, kể cả khi gửi email lỗi', async () => {
      const target = await seedUser();
      fakeMail.failWith(new Error('resend 500'));
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
      );

      await suspend(target.id, 'SUSPENDED', CANARY_REASON);
      await reactivate(target.id, CANARY_REASON);

      const logged = spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map(String)
        .join('\n');
      expect(logged).toContain(target.id);
      expect(logged).not.toContain('CANARY-REASON');
      expect(logged).not.toContain(target.email);
    });
  });

  // --- Swagger -----------------------------------------------------------------------------------

  describe('Swagger khớp hành vi thật', () => {
    it('hai route có tài liệu, chỉ khai báo 200 là thành công, và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin').setVersion('0').build(),
      );
      const operationOf = (path: string) =>
        (
          document.paths[path] as
            Record<string, { responses: Record<string, unknown> }> | undefined
        )?.post;

      for (const [path, statuses] of [
        ['/api/v1/admin/users/{id}/suspend', observed.suspend],
        ['/api/v1/admin/users/{id}/reactivate', observed.reactivate],
      ] as const) {
        const operation = operationOf(path);
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
        for (const status of statuses) expect(documented).toContain(status);
        expect([...statuses].sort()).toEqual([200, 400, 401, 403, 404, 409]);
      }
    });
  });
});
