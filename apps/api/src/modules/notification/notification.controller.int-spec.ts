import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import {
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationSchema,
  notificationUnreadCountSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { createFakeRealtimeEmitter } from '../../shared/testing/fake-realtime-emitter';

// Integration test qua HTTP THẬT (supertest + Postgres thật + đăng nhập bằng cookie) cho controller thông báo (Week10.md 7.6):
// guard gắn đúng route, mọi truy vấn gắn với NGƯỜI GỌI (chống IDOR: thông báo của người khác, không tồn tại và id sai dạng
// cùng một 404, body/query không đổi được chủ), phân trang bằng con trỏ không trùng/mất kể cả khi nhiều dòng cùng mili-giây,
// đánh dấu đã đọc idempotent và an toàn khi gọi đồng thời, và status thực khớp tài liệu Swagger. Chạy: `pnpm test:int`.
const TAG = 'it-notification-http-';

const strictNotification = notificationSchema;
const listSchema = z.object({
  items: z.array(strictNotification),
  nextCursor: z.string().nullable(),
});

interface Envelope {
  success: boolean;
  data: unknown;
  message?: string;
}

describe('Notification controller (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const fakeMail = createFakeMail();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  interface Account {
    agent: Agent;
    userId: string;
  }

  // Ghi lại mọi status đã thấy trên từng route (theo khuôn đường dẫn Swagger) để đối chiếu với tài liệu ở cuối file.
  const observed = new Map<string, Set<number>>();

  async function call(
    agent: Agent,
    method: 'get' | 'post',
    template: string,
    params: Record<string, string> = {},
    options: { body?: unknown; query?: Record<string, string | number> } = {},
  ) {
    const path = Object.entries(params).reduce(
      (acc, [key, value]) => acc.replace(`{${key}}`, value),
      template,
    );
    let req = agent[method](`/api/v1${path}`);
    if (options.query) req = req.query(options.query);
    if (options.body !== undefined) req = req.send(options.body as object);
    const res = await req;
    const key = `${method.toUpperCase()} /api/v1${template}`;
    observed.set(key, (observed.get(key) ?? new Set<number>()).add(res.status));
    return res;
  }
  const dataOf = (res: { body: unknown }) => (res.body as Envelope).data;
  const list = (agent: Agent, query: Record<string, string | number> = {}) =>
    call(agent, 'get', '/notifications', {}, { query });
  const markRead = (agent: Agent, id: string, body?: unknown) =>
    call(agent, 'post', '/notifications/{id}/read', { id }, { body });

  async function register(
    suffix: string,
    options: { verified: boolean; status?: 'SUSPENDED' } = { verified: true },
  ): Promise<Account> {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`.toLowerCase();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', name: `${TAG}${suffix}` })
      .expect(201);
    await prisma.user.update({
      where: { email },
      data: {
        emailVerifiedAt: options.verified ? new Date() : null,
      },
    });
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    if (options.status) {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: options.status },
      });
    }
    return { agent, userId: user.id };
  }

  // Ghi thẳng bằng Prisma (đi vòng qua bên ghi) để kiểm soát chính xác mốc thời gian và trạng thái đọc.
  let seq = 0;
  async function seed(
    userId: string,
    overrides: {
      type?: string;
      data?: unknown;
      createdAt?: Date;
      readAt?: Date | null;
    } = {},
  ) {
    seq++;
    return prisma.notification.create({
      data: {
        userId,
        type: overrides.type ?? 'ORDER_NEW',
        data: overrides.data ?? { orderId: randomUUID() },
        createdAt:
          overrides.createdAt ?? new Date(Date.UTC(2030, 0, 1, 0, 0, seq)),
        readAt: overrides.readAt ?? null,
      },
      select: { id: true, createdAt: true },
    });
  }
  const clearInbox = (userId: string) =>
    prisma.notification.deleteMany({ where: { userId } });
  const readAtOf = async (id: string) =>
    (
      await prisma.notification.findUniqueOrThrow({
        where: { id },
        select: { readAt: true },
      })
    ).readAt;

  let guest: Agent;
  let alice: Account;
  let bob: Account;
  let unverified: Account;
  let locked: Account;

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .overrideProvider(REALTIME_EMITTER)
      .useValue(createFakeRealtimeEmitter())
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    // LISTEN MỘT LẦN (cổng ngẫu nhiên): xem lý do ở chat.controller.int-spec.ts (supertest + request song song).
    await app.listen(0);

    guest = newAgent();
    alice = await register('alice');
    bob = await register('bob');
    unverified = await register('unverified', { verified: false });
    locked = await register('locked', { verified: true, status: 'SUSPENDED' });
  });

  beforeEach(async () => {
    await Promise.all(
      [alice, bob, unverified].map((a) => clearInbox(a.userId)),
    );
  });

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    await app.close();
  });

  describe('xác thực', () => {
    it.each([
      ['get', '/notifications'],
      ['get', '/notifications/unread-count'],
      ['post', '/notifications/read-all'],
      ['post', `/notifications/${randomUUID()}/read`],
    ] as const)('khách chưa đăng nhập: %s %s ⇒ 401', async (method, path) => {
      const res = await guest[method](`/api/v1${path}`);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false });
      observed.set(
        `${method.toUpperCase()} /api/v1${path.replace(/[0-9a-f-]{36}/, '{id}')}`,
        (
          observed.get(
            `${method.toUpperCase()} /api/v1${path.replace(/[0-9a-f-]{36}/, '{id}')}`,
          ) ?? new Set<number>()
        ).add(401),
      );
    });

    it('tài khoản bị khoá ⇒ 401 ngay (JwtStrategy kiểm lại DB), kể cả khi cookie còn hạn', async () => {
      const res = await list(locked.agent);
      expect(res.status).toBe(401);
    });

    it('người CHƯA xác thực email vẫn đọc và đánh dấu được thông báo của mình (không đòi EmailVerifiedGuard)', async () => {
      const n = await seed(unverified.userId);

      expect((await list(unverified.agent)).status).toBe(200);
      expect(
        (await call(unverified.agent, 'get', '/notifications/unread-count'))
          .status,
      ).toBe(200);
      expect((await markRead(unverified.agent, n.id)).status).toBe(200);
      expect(
        (await call(unverified.agent, 'post', '/notifications/read-all'))
          .status,
      ).toBe(200);
    });
  });

  describe('GET /notifications', () => {
    it('chỉ trả thông báo CỦA NGƯỜI GỌI, mới nhất trước, mỗi phần tử đúng schema API; không lộ userId', async () => {
      const a1 = await seed(alice.userId);
      const a2 = await seed(alice.userId);
      await seed(bob.userId);

      const res = await list(alice.agent);

      expect(res.status).toBe(200);
      const body = listSchema.parse(dataOf(res));
      expect(body.items.map((n) => n.id)).toEqual([a2.id, a1.id]);
      expect(body.nextCursor).toBeNull();
      expect(res.text).not.toContain(alice.userId);
      expect(res.text).not.toContain(bob.userId);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('?userId= / ?id= trong query KHÔNG đổi được chủ: vẫn chỉ thấy thông báo của chính mình', async () => {
      await seed(alice.userId);
      const b = await seed(bob.userId);

      const res = await list(alice.agent, { userId: bob.userId });

      const ids = listSchema.parse(dataOf(res)).items.map((n) => n.id);
      expect(ids).not.toContain(b.id);
      expect(ids).toHaveLength(1);
    });

    it('hộp thư rỗng ⇒ items rỗng, nextCursor null', async () => {
      const res = await list(alice.agent);

      expect(dataOf(res)).toEqual({ items: [], nextCursor: null });
    });

    it('phân trang: duyệt hết bằng con trỏ KHÔNG trùng/mất dòng nào, kể cả khi nhiều dòng cùng mili-giây', async () => {
      const same = new Date('2031-05-05T05:05:05.005Z');
      const ids: string[] = [];
      for (let i = 0; i < 7; i++)
        ids.push((await seed(alice.userId, { createdAt: same })).id);
      for (let i = 0; i < 6; i++) ids.push((await seed(alice.userId)).id);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await list(alice.agent, {
          limit: 4,
          ...(cursor ? { cursor } : {}),
        });
        expect(res.status).toBe(200);
        const body = listSchema.parse(dataOf(res));
        seen.push(...body.items.map((n) => n.id));
        cursor = body.nextCursor ?? undefined;
        pages++;
        expect(pages).toBeLessThan(10);
      } while (cursor);

      expect(pages).toBe(4); // 13 dòng / 4
      expect(new Set(seen).size).toBe(13);
      expect([...seen].sort()).toEqual([...ids].sort());
      // Thứ tự toàn cục: createdAt giảm dần, cùng createdAt thì id giảm dần.
      const rows = await prisma.notification.findMany({
        where: { userId: alice.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      expect(seen).toEqual(rows.map((r) => r.id));
    });

    it('trang đúng bằng limit và không còn gì ⇒ nextCursor null (không có trang rỗng thừa)', async () => {
      await seed(alice.userId);
      await seed(alice.userId);

      const body = listSchema.parse(
        dataOf(await list(alice.agent, { limit: 2 })),
      );

      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
    });

    it('thông báo mới tới GIỮA các trang không làm lệch trang đang duyệt (con trỏ theo khoá, không theo vị trí)', async () => {
      for (let i = 0; i < 5; i++) await seed(alice.userId);
      const first = listSchema.parse(
        dataOf(await list(alice.agent, { limit: 2 })),
      );
      await seed(alice.userId, {
        createdAt: new Date('2040-01-01T00:00:00.000Z'),
      });

      const second = listSchema.parse(
        dataOf(
          await list(alice.agent, {
            limit: 2,
            cursor: first.nextCursor as string,
          }),
        ),
      );

      const firstIds = new Set(first.items.map((n) => n.id));
      expect(second.items.every((n) => !firstIds.has(n.id))).toBe(true);
      expect(second.items).toHaveLength(2);
    });

    it('unreadOnly=true chỉ trả chưa đọc; unreadOnly=false trả tất cả', async () => {
      const unread = await seed(alice.userId);
      const read = await seed(alice.userId, { readAt: new Date() });

      const only = listSchema.parse(
        dataOf(await list(alice.agent, { unreadOnly: 'true' })),
      );
      const all = listSchema.parse(
        dataOf(await list(alice.agent, { unreadOnly: 'false' })),
      );

      expect(only.items.map((n) => n.id)).toEqual([unread.id]);
      expect(all.items.map((n) => n.id).sort()).toEqual(
        [unread.id, read.id].sort(),
      );
      expect(only.items[0].readAt).toBeNull();
    });

    it('thông báo đã đọc mang readAt là chuỗi ISO', async () => {
      const at = new Date('2030-06-06T06:06:06.000Z');
      await seed(alice.userId, { readAt: at });

      const body = listSchema.parse(dataOf(await list(alice.agent)));

      expect(body.items[0].readAt).toBe('2030-06-06T06:06:06.000Z');
    });

    it.each([
      ['limit = 0', { limit: 0 }],
      ['limit = 51 (vượt trần 50)', { limit: 51 }],
      ['limit không phải số', { limit: 'abc' }],
      ['unreadOnly = yes', { unreadOnly: 'yes' }],
      ['unreadOnly = 1', { unreadOnly: '1' }],
      ['cursor chứa ký tự lạ', { cursor: 'a b/c' }],
      [
        'cursor đúng bộ ký tự nhưng không phải con trỏ thật',
        { cursor: 'bm90LWEtY3Vyc29y' },
      ],
    ])('%s ⇒ 400', async (_name, query) => {
      const res = await list(alice.agent, query);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });

    it('limit = 50 (đúng trần) được chấp nhận', async () => {
      expect((await list(alice.agent, { limit: 50 })).status).toBe(200);
    });

    it('loại lạ hoặc dữ liệu hỏng KHÔNG làm hỏng trang: rơi về UNKNOWN, dữ liệu lạ không ra ngoài', async () => {
      await seed(alice.userId);
      await seed(alice.userId, {
        type: 'PROMO_BLAST',
        data: { title: 'Giảm 90%', url: 'https://evil.example/phish' },
      });
      await seed(alice.userId, { data: { orderId: 'không-phải-uuid' } });
      await seed(alice.userId, {
        data: { orderId: randomUUID(), url: 'https://evil.example/phish2' },
      });

      const res = await list(alice.agent);

      expect(res.status).toBe(200);
      const body = listSchema.parse(dataOf(res));
      expect(body.items.map((n) => n.type).sort()).toEqual([
        'ORDER_NEW',
        'UNKNOWN',
        'UNKNOWN',
        'UNKNOWN',
      ]);
      expect(res.text).not.toContain('evil.example');
      for (const item of body.items.filter((n) => n.type === 'UNKNOWN')) {
        expect(item.data).toEqual({});
      }
    });

    it('chữ do người dùng nhập được trả NGUYÊN VĂN dưới dạng chuỗi JSON (không HTML hoá), nên FE tự escape khi hiển thị', async () => {
      const label = '<img src=x onerror=alert(1)>';
      await seed(alice.userId, {
        type: 'ORDER_CONFIRMED',
        data: { orderId: randomUUID(), shopName: label },
      });

      const body = listSchema.parse(dataOf(await list(alice.agent)));

      expect(body.items[0].data).toMatchObject({ shopName: label });
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('đếm CHÍNH XÁC (không trần) và chỉ thông báo của người gọi', async () => {
      for (let i = 0; i < 60; i++) {
        await prisma.notification.create({
          data: {
            userId: alice.userId,
            type: 'ORDER_NEW',
            data: { orderId: randomUUID() },
          },
        });
      }
      await seed(alice.userId, { readAt: new Date() });
      await seed(bob.userId);

      const res = await call(alice.agent, 'get', '/notifications/unread-count');

      expect(res.status).toBe(200);
      expect(notificationUnreadCountSchema.parse(dataOf(res))).toEqual({
        unreadCount: 60,
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('giảm sau khi đánh dấu đã đọc; hộp thư rỗng ⇒ 0', async () => {
      const n = await seed(alice.userId);
      await seed(alice.userId);
      const count = async () =>
        notificationUnreadCountSchema.parse(
          dataOf(await call(alice.agent, 'get', '/notifications/unread-count')),
        ).unreadCount;

      expect(await count()).toBe(2);
      await markRead(alice.agent, n.id);
      expect(await count()).toBe(1);
      await call(alice.agent, 'post', '/notifications/read-all');
      expect(await count()).toBe(0);
    });
  });

  describe('POST /notifications/:id/read', () => {
    it('đánh dấu thông báo của mình: 200 kèm mốc đọc, DB có mốc đó', async () => {
      const n = await seed(alice.userId);

      const res = await markRead(alice.agent, n.id);

      expect(res.status).toBe(200);
      const { readAt } = markNotificationReadResultSchema.parse(dataOf(res));
      expect((await readAtOf(n.id))?.toISOString()).toBe(readAt);
    });

    it('IDEMPOTENT: gọi lại trả ĐÚNG mốc cũ và KHÔNG ghi đè trong DB', async () => {
      const n = await seed(alice.userId);
      const first = markNotificationReadResultSchema.parse(
        dataOf(await markRead(alice.agent, n.id)),
      );
      await new Promise((r) => setTimeout(r, 15));

      const second = markNotificationReadResultSchema.parse(
        dataOf(await markRead(alice.agent, n.id)),
      );

      expect(second.readAt).toBe(first.readAt);
      expect((await readAtOf(n.id))?.toISOString()).toBe(first.readAt);
    });

    it('thông báo đã đọc từ trước: trả đúng mốc đã có, không đổi', async () => {
      const at = new Date('2030-03-03T03:03:03.000Z');
      const n = await seed(alice.userId, { readAt: at });

      const res = await markRead(alice.agent, n.id);

      expect(markNotificationReadResultSchema.parse(dataOf(res)).readAt).toBe(
        '2030-03-03T03:03:03.000Z',
      );
    });

    it('10 request ĐỒNG THỜI cho cùng một thông báo: tất cả 200, cùng MỘT mốc đọc, DB chỉ có mốc đó', async () => {
      const n = await seed(alice.userId);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => markRead(alice.agent, n.id)),
      );

      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      const stamps = new Set(
        results.map(
          (r) => markNotificationReadResultSchema.parse(dataOf(r)).readAt,
        ),
      );
      expect(stamps.size).toBe(1);
      expect((await readAtOf(n.id))?.toISOString()).toBe([...stamps][0]);
    });

    it('thông báo CỦA NGƯỜI KHÁC, id không tồn tại, id sai dạng: CÙNG một 404 (so nguyên body), thông báo của người kia không bị đụng', async () => {
      const others = await seed(bob.userId);

      const responses = await Promise.all([
        markRead(alice.agent, others.id),
        markRead(alice.agent, randomUUID()),
        markRead(alice.agent, 'khong-phai-uuid'),
        markRead(alice.agent, "'; DROP TABLE notifications; --"),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body).toMatchObject({
        success: false,
        message: 'Notification not found',
      });
      expect(await readAtOf(others.id)).toBeNull();
    });

    it('body gửi kèm userId/id của người khác KHÔNG đổi được chủ: vẫn 404 và không đụng thông báo của họ', async () => {
      const others = await seed(bob.userId);
      const mine = await seed(alice.userId);

      const res = await markRead(alice.agent, others.id, {
        userId: bob.userId,
        id: others.id,
      });

      expect(res.status).toBe(404);
      expect(await readAtOf(others.id)).toBeNull();
      // Và route cũng không nhận id từ body để đánh dấu thay cho param.
      const res2 = await markRead(alice.agent, mine.id, { id: others.id });
      expect(res2.status).toBe(200);
      expect(await readAtOf(others.id)).toBeNull();
    });
  });

  describe('POST /notifications/read-all', () => {
    it('đánh dấu mọi thông báo chưa đọc CỦA MÌNH, trả số dòng; không đụng thông báo đã đọc và của người khác', async () => {
      await seed(alice.userId);
      await seed(alice.userId);
      const oldRead = new Date('2030-04-04T04:04:04.000Z');
      const already = await seed(alice.userId, { readAt: oldRead });
      const bobs = await seed(bob.userId);

      const res = await call(alice.agent, 'post', '/notifications/read-all');

      expect(res.status).toBe(200);
      expect(markAllNotificationsReadResultSchema.parse(dataOf(res))).toEqual({
        updatedCount: 2,
      });
      expect((await readAtOf(already.id))?.toISOString()).toBe(
        oldRead.toISOString(),
      );
      expect(await readAtOf(bobs.id)).toBeNull();
      expect(
        await prisma.notification.count({
          where: { userId: alice.userId, readAt: null },
        }),
      ).toBe(0);
    });

    it('IDEMPOTENT: gọi lại ⇒ updatedCount 0', async () => {
      await seed(alice.userId);
      await call(alice.agent, 'post', '/notifications/read-all');

      const res = await call(alice.agent, 'post', '/notifications/read-all');

      expect(res.status).toBe(200);
      expect(markAllNotificationsReadResultSchema.parse(dataOf(res))).toEqual({
        updatedCount: 0,
      });
    });

    it('hai lần gọi ĐỒNG THỜI: tổng số dòng đánh dấu đúng bằng số thông báo chưa đọc (không dòng nào bị đếm hai lần)', async () => {
      for (let i = 0; i < 12; i++) await seed(alice.userId);

      const results = await Promise.all([
        call(alice.agent, 'post', '/notifications/read-all'),
        call(alice.agent, 'post', '/notifications/read-all'),
      ]);

      const counts = results.map(
        (r) =>
          markAllNotificationsReadResultSchema.parse(dataOf(r)).updatedCount,
      );
      expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
    });

    it('"đọc hết" không động tới người khác dù cả hai cùng có thông báo chưa đọc', async () => {
      await seed(alice.userId);
      await seed(bob.userId);
      await seed(bob.userId);

      await call(alice.agent, 'post', '/notifications/read-all');

      expect(
        await prisma.notification.count({
          where: { userId: bob.userId, readAt: null },
        }),
      ).toBe(2);
    });
  });

  describe('Swagger khớp với hành vi thật', () => {
    const ROUTES: Array<['get' | 'post', string]> = [
      ['get', '/notifications'],
      ['get', '/notifications/unread-count'],
      ['post', '/notifications/read-all'],
      ['post', '/notifications/{id}/read'],
    ];

    it('mọi route có tài liệu; status thành công khai báo ĐÚNG bằng status thực quan sát được; mọi status lỗi đã thấy đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('notification').setVersion('0').build(),
      );
      const problems: string[] = [];
      for (const [method, template] of ROUTES) {
        const key = `${method.toUpperCase()} /api/v1${template}`;
        const operation = (
          document.paths[`/api/v1${template}`] as
            Record<string, { responses: Record<string, unknown> }> | undefined
        )?.[method];
        const seen = observed.get(key);
        if (!operation) {
          problems.push(`${key}: không có trong tài liệu Swagger`);
          continue;
        }
        if (!seen) {
          problems.push(`${key}: test chưa gọi route này`);
          continue;
        }
        const documented = Object.keys(operation.responses).map(Number);
        const documentedOk = documented
          .filter((s) => s >= 200 && s < 300)
          .sort();
        const seenOk = [...seen].filter((s) => s >= 200 && s < 300).sort();
        if (JSON.stringify(documentedOk) !== JSON.stringify(seenOk)) {
          problems.push(
            `${key}: khai báo thành công ${documentedOk.join(',')} nhưng thực tế ${seenOk.join(',')}`,
          );
        }
        for (const status of seen) {
          if (!documented.includes(status)) {
            problems.push(`${key}: gặp status ${status} nhưng không khai báo`);
          }
        }
      }

      expect(problems).toEqual([]);
    });
  });
});
