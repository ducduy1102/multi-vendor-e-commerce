import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PrismaClient,
  type AccountStatus,
  type Role,
  type ShopStatus,
} from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ADMIN_USER_HISTORY_LIMIT,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  type AdminUser,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import {
  cleanupByTag,
  createOrderWithItem,
  createShopWithProduct,
  createVariant,
} from '../../shared/testing/db-fixtures';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho quản lý người dùng của Admin (Week11.md 3.2). Chứng
// minh điều unit test với mock không chứng minh được: RolesGuard thật chặn khách / user thường ở MỌI route, tìm kiếm
// không phân biệt hoa-thường VÀ dấu chạy đúng trên unaccent của Postgres (kể cả Đ/đ), ký tự % _ \ trong từ khoá được hiểu
// đúng nghĩa đen, bộ lọc vai / trạng thái, phân trang không trùng không sót khi nhiều người cùng một mili-giây, response
// không chứa bất cứ trường bí mật nào của DB, và chi tiết lấy đúng shop / đơn / lịch sử nhật ký của chính người đó.
// Chạy: `pnpm test:int`.
const TAG = 'it-admin-user-';
const PASSWORD = 'password123';
const MIN_MS = 60 * 1000;

describe('AdminUserController (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  // Mọi email của spec này bắt đầu bằng P (để dọn theo TAG). M là MỘT TỪ KHOÁ DUY NHẤT nằm trong tên của mọi người
  // dùng dựng sẵn: tìm `q=M` cho đúng tập này dù DB dev có hàng nghìn người dùng khác, và `q='nguyen ' + M` chỉ khớp
  // người tên "Nguyễn <M>" chứ không khớp mọi Nguyễn trong DB.
  const P = `${TAG}${stamp}-`;
  const M = `zq${stamp}`;
  const base = Date.now() - 2 * 60 * MIN_MS;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;
  let adminName: string;

  const observed = { list: new Set<number>(), detail: new Set<number>() };

  const listRaw = async (agent: Agent, query: Record<string, string> = {}) => {
    const res = await agent.get('/api/v1/admin/users').query(query);
    observed.list.add(res.status);
    return res;
  };
  const detailRaw = async (agent: Agent, id: string) => {
    const res = await agent.get(`/api/v1/admin/users/${id}`);
    observed.detail.add(res.status);
    return res;
  };

  const list = async (query: Record<string, string> = {}) => {
    const res = await listRaw(admin, query);
    expect(res.status).toBe(200);
    return (res.body as { data: ListData }).data;
  };
  const detail = async (id: string) => {
    const res = await detailRaw(admin, id);
    expect(res.status).toBe(200);
    return (res.body as { data: DetailData }).data;
  };
  type ListData = {
    items: AdminUser[];
    total: number;
    page: number;
    limit: number;
  };
  type DetailData = AdminUser & {
    locale: string;
    orderCount: number;
    shops: { id: string; name: string; slug: string; status: string }[];
    history: {
      id: string;
      action: string;
      actorId: string;
      actorName: string | null;
      reason: string | null;
      meta: Record<string, unknown>;
      createdAt: string;
    }[];
  };

  const search = async (q: string, extra: Record<string, string> = {}) =>
    list({ q, limit: '50', ...extra });
  const labels = (items: AdminUser[]) =>
    items.map((item) => item.email.slice(P.length).replace('@test.local', ''));

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  // Người dùng dựng sẵn: email `${P}<label>@test.local`, tên chứa M.
  interface SeedUser {
    name: string;
    createdAt: Date;
    role?: Role;
    status?: AccountStatus;
    statusReason?: string;
    verified?: boolean;
    locale?: 'vi' | 'en';
    secrets?: boolean;
  }
  const ids: Record<string, string> = {};

  async function seedUser(label: string, input: SeedUser) {
    const row = await prisma.user.create({
      data: {
        email: `${P}${label}@test.local`,
        name: input.name,
        role: input.role ?? 'USER',
        accountStatus: input.status ?? 'ACTIVE',
        statusReason: input.statusReason ?? null,
        statusChangedAt: input.statusReason ? new Date(base) : null,
        emailVerifiedAt: input.verified === false ? null : new Date(base),
        locale: input.locale ?? 'vi',
        createdAt: input.createdAt,
        ...(input.secrets
          ? {
              passwordHash: `CANARY-PASSWORD-HASH-${stamp}`,
              refreshTokenHash: `CANARY-REFRESH-HASH-${stamp}`,
              emailVerificationTokenHash: `CANARY-VERIFY-HASH-${stamp}`,
              emailVerificationExpiresAt: new Date(base),
              passwordResetTokenHash: `CANARY-RESET-HASH-${stamp}`,
              passwordResetExpiresAt: new Date(base),
            }
          : {}),
      },
      select: { id: true },
    });
    ids[label] = row.id;
    return row.id;
  }

  const at = (minutes: number) => new Date(base + minutes * MIN_MS);

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): supertest tự listen/close theo từng request sẽ gây
    // ECONNRESET ngẫu nhiên khi test bắn nhiều request song song.
    await app.listen(0);

    const adminEmail = `${P}admin-login@test.local`;
    await seedAdmin(prisma, { email: adminEmail, password: PASSWORD });
    admin = newAgent();
    await loginAs(admin, adminEmail);
    const adminRow = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
      select: { id: true, name: true },
    });
    adminId = adminRow.id;
    adminName = adminRow.name;

    plainUser = newAgent();
    const plainEmail = `${P}plain-login@test.local`;
    await plainUser
      .post('/api/v1/auth/register')
      .send({ email: plainEmail, password: PASSWORD, name: `${TAG}plain` })
      .expect(201);
    await loginAs(plainUser, plainEmail);
    anonymous = newAgent();

    // Mười một người dùng dựng sẵn, thời điểm tạo cách nhau 1 phút; `binh` và `cuong` CÙNG một mili-giây (để kiểm khoá
    // phụ `id` của thứ tự khi phân trang cắt ngang nhóm đồng hạng).
    await seedUser('an', { name: `Nguyễn ${M}`, createdAt: at(1) });
    await seedUser('binh', { name: `Đặng ${M}`, createdAt: at(2) });
    await seedUser('cuong', { name: `Trần Đức ${M}`, createdAt: at(2) });
    await seedUser('pct', { name: `100%${M}`, createdAt: at(3) });
    await seedUser('und', { name: `a_${M}`, createdAt: at(4) });
    await seedUser('bsl', { name: `x\\${M}`, createdAt: at(5) });
    await seedUser('adm', {
      name: `Quản Trị ${M}`,
      createdAt: at(6),
      role: 'ADMIN',
    });
    await seedUser('sus', {
      name: `Tạm Khoá ${M}`,
      createdAt: at(7),
      status: 'SUSPENDED',
      statusReason: 'Vi phạm điều khoản',
    });
    await seedUser('ban', {
      name: `Bị Cấm ${M}`,
      createdAt: at(8),
      status: 'BANNED',
      statusReason: 'Gian lận',
    });
    await seedUser('dea', {
      name: `Tự Xoá ${M}`,
      createdAt: at(9),
      status: 'DEACTIVATED',
    });
    await seedUser('unv', {
      name: `Chưa Xác Thực ${M}`,
      createdAt: at(10),
      verified: false,
      secrets: true,
    });
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // --- Quyền truy cập ----------------------------------------------------------------------------

  describe('quyền truy cập (RolesGuard thật)', () => {
    it('khách ⇒ 401 ở cả danh sách lẫn chi tiết', async () => {
      expect((await listRaw(anonymous)).status).toBe(401);
      expect((await detailRaw(anonymous, ids.an)).status).toBe(401);
    });

    it('user thường ⇒ 403 ở cả danh sách lẫn chi tiết, và không lộ gì của người khác', async () => {
      const listed = await listRaw(plainUser, { q: M });
      const detailed = await detailRaw(plainUser, ids.an);

      expect(listed.status).toBe(403);
      expect(detailed.status).toBe(403);
      expect(JSON.stringify([listed.body, detailed.body])).not.toContain(P);
    });

    it('Admin ⇒ 200, Cache-Control: no-store (dữ liệu tài khoản riêng tư)', async () => {
      const listed = await listRaw(admin, { q: M });
      const detailed = await detailRaw(admin, ids.an);

      expect(listed.status).toBe(200);
      expect(detailed.status).toBe(200);
      expect(listed.headers['cache-control']).toBe('no-store');
      expect(detailed.headers['cache-control']).toBe('no-store');
    });
  });

  // --- Tìm kiếm ----------------------------------------------------------------------------------

  describe('tìm kiếm theo email / tên', () => {
    it('q chỉ có từ khoá duy nhất ⇒ đúng 11 người dùng dựng sẵn', async () => {
      const result = await search(M);

      expect(result.total).toBe(11);
      expect(labels(result.items).sort()).toEqual(
        [
          'adm',
          'an',
          'ban',
          'binh',
          'bsl',
          'cuong',
          'dea',
          'pct',
          'sus',
          'und',
          'unv',
        ].sort(),
      );
    });

    it.each([
      ['không dấu, chữ thường', `nguyen ${M}`, ['an']],
      ['không dấu, chữ HOA', `NGUYEN ${M}`, ['an']],
      ['có dấu đúng như lưu', `Nguyễn ${M}`, ['an']],
      ['có dấu, chữ HOA', `NGUYỄN ${M}`, ['an']],
      ['đ thường bỏ dấu thành d', `dang ${M}`, ['binh']],
      ['Đ hoa gõ có dấu', `ĐẶNG ${M}`, ['binh']],
      ['giữa chuỗi, bỏ dấu', `duc ${M}`, ['cuong']],
      ['chỉ một phần của tên', `guyen ${M}`, ['an']],
    ])('tên: %s', async (_name, q, expected) => {
      const result = await search(q);

      expect(labels(result.items)).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });

    it('khoảng trắng hai đầu từ khoá được bỏ đi', async () => {
      const result = await search(`   nguyen ${M}   `);

      expect(labels(result.items)).toEqual(['an']);
    });

    it.each([
      ['email đầy đủ phần đầu', `${P}binh@`, ['binh']],
      ['email viết HOA', `${P}BINH@`.toUpperCase(), ['binh']],
      ['một phần email', `${P}cuong@test`, ['cuong']],
    ])('email: %s', async (_name, q, expected) => {
      const result = await search(q);

      expect(labels(result.items)).toEqual(expected);
    });

    it('không khớp ai ⇒ danh sách rỗng, total 0 (không phải lỗi)', async () => {
      const result = await search(`khong-co-ai-${stamp}`);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 50 });
    });

    // Ba ca dưới là lý do phải thoát ký tự của LIKE: nếu để nguyên, `%` khớp mọi tên và `_` khớp một ký tự bất kỳ nên cả
    // 11 người dùng đều khớp; `\` trước chữ `z` bị hiểu là "thoát chữ z" nên cũng khớp cả 11.
    it.each([
      ['dấu %', `%${M}`, ['pct']],
      ['dấu _', `_${M}`, ['und']],
      ['dấu \\', `\\${M}`, ['bsl']],
    ])(
      'ký tự đặc biệt của LIKE được hiểu đúng nghĩa đen: %s',
      async (_name, q, expected) => {
        const result = await search(q);

        expect(labels(result.items)).toEqual(expected);
        expect(result.total).toBe(1);
      },
    );

    it.each([
      ['từ khoá giống SQL injection', `'; DROP TABLE users; --${M}`],
      ['dấu nháy kép và phẩy', `"a",'b';${M}`],
    ])(
      '%s ⇒ 200 và danh sách rỗng, bảng users còn nguyên',
      async (_name, q) => {
        const before = await prisma.user.count();

        const result = await search(q);

        expect(result.total).toBe(0);
        expect(await prisma.user.count()).toBe(before);
      },
    );

    it('q toàn khoảng trắng coi như không tìm: trả danh sách, không phải 0 và không phải 400', async () => {
      const result = await list({ q: '   ', limit: '50' });

      expect(result.total).toBeGreaterThanOrEqual(11);
    });

    it.each([
      ['dài hơn 254 ký tự', { q: 'a'.repeat(255) }],
      ['có ký tự NUL (Postgres không nhận)', { q: 'a%00b' }],
      ['xuống dòng', { q: 'a%0Ab' }],
    ])('q %s ⇒ 400, không phải 500', async (_name, query) => {
      const res = await admin.get(`/api/v1/admin/users?q=${query.q}`);
      observed.list.add(res.status);

      expect(res.status).toBe(400);
    });

    it('q lặp lại (?q=a&q=b) ⇒ 400 thay vì đoán', async () => {
      const res = await admin.get('/api/v1/admin/users?q=a&q=b');
      observed.list.add(res.status);

      expect(res.status).toBe(400);
    });
  });

  // --- Lọc ---------------------------------------------------------------------------------------

  describe('lọc theo vai và trạng thái (kết hợp với q để chỉ xét 11 người dùng dựng sẵn)', () => {
    it.each([
      ['role=ADMIN', { role: 'ADMIN' }, ['adm']],
      ['status=SUSPENDED', { status: 'SUSPENDED' }, ['sus']],
      ['status=BANNED', { status: 'BANNED' }, ['ban']],
      ['status=DEACTIVATED', { status: 'DEACTIVATED' }, ['dea']],
      [
        'status=ACTIVE',
        { status: 'ACTIVE' },
        ['adm', 'an', 'binh', 'bsl', 'cuong', 'pct', 'und', 'unv'],
      ],
      [
        'role=USER',
        { role: 'USER' },
        [
          'an',
          'ban',
          'binh',
          'bsl',
          'cuong',
          'dea',
          'pct',
          'sus',
          'und',
          'unv',
        ],
      ],
      [
        'role=USER & status=ACTIVE',
        { role: 'USER', status: 'ACTIVE' },
        ['an', 'binh', 'bsl', 'cuong', 'pct', 'und', 'unv'],
      ],
      [
        'role=ADMIN & status=SUSPENDED',
        { role: 'ADMIN', status: 'SUSPENDED' },
        [],
      ],
    ])('%s', async (_name, filter, expected) => {
      const result = await search(M, filter);

      expect(labels(result.items).sort()).toEqual([...expected].sort());
      expect(result.total).toBe(expected.length);
    });

    it('lọc + từ khoá thu hẹp tiếp (q "nguyen" chỉ có ở người ACTIVE)', async () => {
      expect(
        labels((await search(`nguyen ${M}`, { status: 'ACTIVE' })).items),
      ).toEqual(['an']);
      expect((await search(`nguyen ${M}`, { status: 'BANNED' })).total).toBe(0);
    });

    it.each([
      ['role lạ', { role: 'SELLER' }],
      ['role viết thường', { role: 'admin' }],
      ['status lạ', { status: 'DELETED' }],
    ])('%s ⇒ 400', async (_name, query) => {
      const res = await listRaw(admin, query);

      expect(res.status).toBe(400);
    });
  });

  // --- Nội dung một dòng -------------------------------------------------------------------------

  describe('nội dung một dòng danh sách', () => {
    it('người bị khoá hiện lý do + mốc; người chưa từng bị đổi hiện null; email chưa xác thực ⇒ false', async () => {
      const result = await search(M);
      const byLabel = new Map(
        result.items.map((item) => [
          item.email.slice(P.length).replace('@test.local', ''),
          item,
        ]),
      );

      expect(byLabel.get('sus')).toMatchObject({
        accountStatus: 'SUSPENDED',
        statusReason: 'Vi phạm điều khoản',
        statusChangedAt: new Date(base).toISOString(),
        role: 'USER',
        isEmailVerified: true,
      });
      expect(byLabel.get('an')).toMatchObject({
        accountStatus: 'ACTIVE',
        statusReason: null,
        statusChangedAt: null,
        isEmailVerified: true,
      });
      expect(byLabel.get('unv')?.isEmailVerified).toBe(false);
      expect(byLabel.get('adm')?.role).toBe('ADMIN');
    });
  });

  // --- Phân trang và thứ tự ----------------------------------------------------------------------

  describe('phân trang offset', () => {
    it('mới tạo trước: createdAt giảm dần', async () => {
      const result = await search(M);
      const times = result.items.map((item) => item.createdAt);

      expect(times).toEqual([...times].sort().reverse());
      expect(labels(result.items)[0]).toBe('unv');
      expect(labels(result.items).at(-1)).toBe('an');
    });

    it.each([1, 2, 3, 4, 11])(
      'limit=%i: duyệt hết các trang ⇒ đủ 11 người, không trùng, không sót (kể cả nhóm đồng hạng bị cắt ngang)',
      async (limit) => {
        const seen: string[] = [];
        let totalSeen = -1;
        for (let page = 1; page <= 12; page++) {
          const result = await search(M, {
            page: String(page),
            limit: String(limit),
          });
          expect(result.page).toBe(page);
          expect(result.limit).toBe(limit);
          totalSeen = result.total;
          expect(result.items.length).toBeLessThanOrEqual(limit);
          seen.push(...result.items.map((item) => item.id));
          if (result.items.length === 0) break;
        }

        expect(totalSeen).toBe(11);
        expect(seen).toHaveLength(11);
        expect(new Set(seen).size).toBe(11);
        expect(new Set(seen)).toEqual(new Set(Object.values(ids)));
      },
    );

    it('thứ tự giữa các trang giống thứ tự một trang lớn (khoá phụ id ổn định)', async () => {
      const whole = (await search(M)).items.map((item) => item.id);
      const paged: string[] = [];
      for (let page = 1; page <= 4; page++) {
        paged.push(
          ...(await search(M, { page: String(page), limit: '3' })).items.map(
            (item) => item.id,
          ),
        );
      }

      expect(paged).toEqual(whole);
    });

    // 11 dòng quá ít để Postgres xếp nhóm đồng hạng lệch giữa các trang (đã thử: bỏ khoá phụ `id` mà test 11 dòng vẫn xanh).
    // 60 người cùng MỘT mili-giây buộc các trang khác nhau đi qua các thuật toán sắp xếp khác nhau (heapsort chặn trên cho
    // trang nhỏ, quicksort cho trang sâu), nên thiếu khoá phụ thì trang sau lặp lại / bỏ sót người của trang trước. So với thứ
    // tự tham chiếu do CHÍNH DB sinh (cùng collation) thay vì tự so chuỗi id trong JS.
    describe('nhóm đồng hạng lớn (60 người cùng một mili-giây)', () => {
      const T = `tq${stamp}`;
      const TIE_COUNT = 60;
      let reference: string[];

      beforeAll(async () => {
        const createdAt = at(30);
        await prisma.user.createMany({
          data: Array.from({ length: TIE_COUNT }, (_, i) => ({
            id: randomUUID(),
            email: `${P}tie${i}@test.local`,
            name: `Tie ${T}`,
            emailVerifiedAt: createdAt,
            createdAt,
          })),
        });
        reference = (
          await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM users WHERE name LIKE ${`%${T}%`}
            ORDER BY created_at DESC, id DESC`
        ).map((row) => row.id);
      });

      it.each([7, 10, 50])(
        'limit=%i: các trang ghép lại == thứ tự tham chiếu (không trùng, không sót, đúng thứ tự)',
        async (limit) => {
          const paged: string[] = [];
          for (let page = 1; page <= 60; page++) {
            const result = await search(T, {
              page: String(page),
              limit: String(limit),
            });
            expect(result.total).toBe(TIE_COUNT);
            paged.push(...result.items.map((item) => item.id));
            if (result.items.length === 0) break;
          }

          expect(reference).toHaveLength(TIE_COUNT);
          expect(paged).toEqual(reference);
        },
      );
    });

    it('trang vượt quá cuối ⇒ items rỗng nhưng total vẫn đúng', async () => {
      const result = await search(M, { page: '50', limit: '10' });

      expect(result).toMatchObject({
        items: [],
        total: 11,
        page: 50,
        limit: 10,
      });
    });

    it('mặc định page=1, limit=20', async () => {
      const result = await list({ q: M });

      expect(result).toMatchObject({ page: 1, limit: 20, total: 11 });
    });

    it.each([
      ['limit > 50', { limit: '51' }],
      ['limit = 0', { limit: '0' }],
      ['page = 0', { page: '0' }],
      ['page âm', { page: '-1' }],
      ['page không phải số', { page: 'abc' }],
      ['page vượt trần', { page: '100001' }],
      [
        'page = 1e21 (từng làm Postgres báo bigint out of range ⇒ 500)',
        { page: '1e21' },
      ],
      ['limit thập phân', { limit: '2.5' }],
    ])('%s ⇒ 400', async (_name, query) => {
      const res = await listRaw(admin, query);

      expect(res.status).toBe(400);
    });
  });

  // --- Không lộ trường bí mật --------------------------------------------------------------------

  describe('không lộ trường nhạy cảm', () => {
    const SECRET_KEYS = [
      'passwordHash',
      'refreshTokenHash',
      'emailVerificationTokenHash',
      'emailVerificationExpiresAt',
      'emailVerificationSentAt',
      'emailVerifiedAt',
      'passwordResetTokenHash',
      'passwordResetExpiresAt',
      'passwordResetSentAt',
    ];

    it('người dùng có đủ hash / token trong DB: danh sách không chứa giá trị lẫn tên trường nào', async () => {
      const res = await listRaw(admin, { q: M, limit: '50' });
      const text = JSON.stringify(res.body);

      expect(text).not.toMatch(/CANARY/);
      for (const key of SECRET_KEYS) expect(text).not.toContain(key);
    });

    it('chi tiết cũng vậy', async () => {
      const res = await detailRaw(admin, ids.unv);
      const text = JSON.stringify(res.body);

      expect(res.status).toBe(200);
      expect(text).not.toMatch(/CANARY/);
      for (const key of SECRET_KEYS) expect(text).not.toContain(key);
    });

    it('response khớp CHÍNH XÁC schema dùng chung: parse bằng Zod không làm mất trường nào', async () => {
      const listed = await list({ q: M, limit: '50' });
      const detailed = await detail(ids.unv);

      expect(adminUserListResponseSchema.parse(listed)).toEqual(listed);
      expect(adminUserDetailSchema.parse(detailed)).toEqual(detailed);
    });
  });

  // --- Chi tiết ----------------------------------------------------------------------------------

  describe('chi tiết một người dùng', () => {
    let richId: string;
    let shopId: string;
    const DELETED_ACTOR = '99999999-9999-4999-8999-999999999999';

    beforeAll(async () => {
      richId = await seedUser('rich', {
        name: `Chi Tiết ${M}`,
        createdAt: at(20),
        locale: 'en',
        status: 'SUSPENDED',
        statusReason: 'Vi phạm điều khoản',
      });
      await seedUser('bare', { name: `Trống ${M}`, createdAt: at(21) });

      const shop = await prisma.shop.create({
        data: {
          ownerId: richId,
          name: `${TAG}shop-rich`,
          slug: `${TAG}shop-rich-${stamp}`,
          status: 'SUSPENDED' satisfies ShopStatus,
        },
        select: { id: true },
      });
      shopId = shop.id;

      // Hai đơn của người này với tư cách người mua (một hoàn tất, một đã huỷ) + một đơn của người khác.
      const seller = await createShopWithProduct(prisma, TAG);
      const variant = await createVariant(prisma, seller, { stock: 5 });
      await createOrderWithItem(prisma, {
        userId: richId,
        shopId: seller.shopId,
        variantId: variant.id,
        status: 'COMPLETED',
      });
      await createOrderWithItem(prisma, {
        userId: richId,
        shopId: seller.shopId,
        variantId: variant.id,
        status: 'CANCELLED',
      });
      await createOrderWithItem(prisma, {
        userId: ids.an,
        shopId: seller.shopId,
        variantId: variant.id,
        status: 'COMPLETED',
      });

      // 25 dòng nhật ký về người này (chỉ nhận 20 mới nhất) + các dòng KHÔNG được lọt vào.
      const entry = (minutes: number, extra: Record<string, unknown> = {}) =>
        prisma.adminAuditLog.create({
          data: {
            actorId: adminId,
            action: 'SUSPEND_USER',
            targetType: 'USER',
            targetId: richId,
            reason: `lý do ${minutes}`,
            meta: { from: 'ACTIVE', to: 'SUSPENDED' },
            ip: '203.0.113.7',
            userAgent: `CanaryAgent/${stamp}`,
            createdAt: at(100 + minutes),
            ...extra,
          },
        });
      for (let i = 1; i <= 25; i++) await entry(i);
      // Admin đã bị xoá (không có hàng users) + meta hỏng (lồng nhau) + hành động mà FE chưa biết.
      await entry(30, {
        actorId: DELETED_ACTOR,
        action: 'SOME_FUTURE_ACTION',
        reason: null,
        meta: { nested: { secret: `CANARY-META-${stamp}` } },
      });
      // Cùng targetId nhưng KHÁC loại đối tượng, và cùng loại nhưng KHÁC người dùng.
      await entry(40, {
        targetType: 'SHOP',
        action: 'CANCEL_SHOP_OPEN_ORDERS',
      });
      await entry(41, { targetId: ids.an });
    });

    it('trả tài khoản, ngôn ngữ, số đơn đã đặt và shop sở hữu', async () => {
      const result = await detail(richId);

      expect(result).toMatchObject({
        id: richId,
        email: `${P}rich@test.local`,
        accountStatus: 'SUSPENDED',
        statusReason: 'Vi phạm điều khoản',
        locale: 'en',
        orderCount: 2,
        shops: [
          {
            id: shopId,
            name: `${TAG}shop-rich`,
            slug: `${TAG}shop-rich-${stamp}`,
            status: 'SUSPENDED',
          },
        ],
      });
    });

    it('người chưa có gì: shops, history rỗng và orderCount 0 (không phải null / thiếu)', async () => {
      const result = await detail(ids.bare);

      expect(result).toMatchObject({
        orderCount: 0,
        shops: [],
        history: [],
        locale: 'vi',
      });
    });

    it(`lịch sử: tối đa ${ADMIN_USER_HISTORY_LIMIT} dòng MỚI NHẤT trước, đúng đối tượng`, async () => {
      const { history } = await detail(richId);

      // 26 dòng USER của người này (25 + dòng Admin đã xoá, phút 30) ⇒ cắt còn 20 dòng mới nhất.
      expect(history).toHaveLength(ADMIN_USER_HISTORY_LIMIT);
      const times = history.map((h) => h.createdAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(history[0].createdAt).toBe(at(130).toISOString());
      expect(history[1].reason).toBe('lý do 25');
      // Không lẫn dòng của loại đối tượng khác hay của người dùng khác.
      expect(history.map((h) => h.action)).not.toContain(
        'CANCEL_SHOP_OPEN_ORDERS',
      );
      expect(history.map((h) => h.reason)).not.toContain('lý do 41');
      // 20 dòng mới nhất = dòng Admin đã xoá (phút 30) + 19 dòng từ "lý do 25" xuống "lý do 7"; dòng 1..6 bị cắt.
      expect(history.map((h) => h.reason)).not.toContain('lý do 6');
      expect(history.at(-1)?.reason).toBe('lý do 7');
    });

    it('tên Admin được tra ra; Admin đã bị xoá ⇒ actorName null; hành động lạ vẫn trả về', async () => {
      const { history } = await detail(richId);

      const normal = history.find((h) => h.reason === 'lý do 25');
      const orphan = history.find((h) => h.actorId === DELETED_ACTOR);
      expect(normal).toMatchObject({
        actorId: adminId,
        actorName: adminName,
        action: 'SUSPEND_USER',
        meta: { from: 'ACTIVE', to: 'SUSPENDED' },
      });
      expect(orphan).toMatchObject({
        actorName: null,
        action: 'SOME_FUTURE_ACTION',
        reason: null,
      });
    });

    it('KHÔNG lộ IP / User-Agent của Admin dù có trong DB, và meta hỏng ra {}', async () => {
      const res = await detailRaw(admin, richId);
      const text = JSON.stringify(res.body);
      const orphan = (res.body as { data: DetailData }).data.history.find(
        (h) => h.actorId === DELETED_ACTOR,
      );

      expect(text).not.toContain('203.0.113.7');
      expect(text).not.toContain('CanaryAgent');
      expect(text).not.toMatch(/"(ip|userAgent)"/);
      expect(orphan?.meta).toEqual({});
      expect(text).not.toContain('CANARY-META');
    });

    it('đơn của người khác không bị tính vào orderCount', async () => {
      const result = await detail(ids.an);

      expect(result.orderCount).toBe(1);
    });

    it('chi tiết của một Admin cũng xem được (vai ADMIN hiện đúng)', async () => {
      const result = await detail(ids.adm);

      expect(result.role).toBe('ADMIN');
    });
  });

  // --- 404 đồng nhất -----------------------------------------------------------------------------

  describe('id không tồn tại hoặc sai dạng', () => {
    const UNKNOWN = '00000000-0000-4000-8000-000000000000';

    it('id không có thật ⇒ 404 USER_NOT_FOUND', async () => {
      const res = await detailRaw(admin, UNKNOWN);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    });

    it.each([
      ['chuỗi tuỳ ý', 'abc'],
      ['thiếu một ký tự', UNKNOWN.slice(0, -1)],
      ['có ký tự NUL (Postgres từ chối nếu lọt tới DB)', `${UNKNOWN}%00`],
      ['dấu nháy SQL', "1'%20OR%20'1'='1"],
    ])(
      'id %s ⇒ CÙNG status và CÙNG body với id không tồn tại (không có oracle phân biệt)',
      async (_name, id) => {
        const unknown = await detailRaw(admin, UNKNOWN);
        const res = await detailRaw(admin, id);

        expect(res.status).toBe(404);
        expect(res.body).toEqual(unknown.body);
      },
    );
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
        )?.get;

      for (const [path, statuses, expected] of [
        ['/api/v1/admin/users', observed.list, [200, 400, 401, 403]],
        ['/api/v1/admin/users/{id}', observed.detail, [200, 401, 403, 404]],
      ] as const) {
        const operation = operationOf(path);
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
        for (const status of statuses) expect(documented).toContain(status);
        expect([...statuses].sort()).toEqual([...expected]);
      }
    });
  });
});
