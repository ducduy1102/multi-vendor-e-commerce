import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type ShopStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import {
  chatMessageSchema,
  conversationSummarySchema,
  markReadResultSchema,
  unreadCountSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { REALTIME_EMITTER } from '../../shared/realtime/realtime-emitter';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import {
  createFakeRealtimeEmitter,
  type FakeRealtimeEmitter,
} from '../../shared/testing/fake-realtime-emitter';

// Integration test qua HTTP THẬT (supertest + Postgres thật + đăng nhập bằng cookie) cho hai controller chat
// (Week10.md 4.6). Chứng minh điều test service không chứng minh được: guard (JwtAuthGuard, EmailVerifiedGuard,
// ShopOwnerGuard) được gắn đúng route, status/code thực khớp tài liệu Swagger, body request bị Zod lọc (không
// giả mạo được người gửi), mọi route chat chống IDOR đúng, và response không lộ định danh người dùng.
// Chạy: `pnpm test:int`.
const TAG = 'it-chat-http-';

const strictSummary = conversationSummarySchema.strict();
const strictMessage = chatMessageSchema.strict();
const summaryList = z.object({
  items: z.array(strictSummary),
  nextCursor: z.string().nullable(),
});
const messageList = z.object({
  items: z.array(strictMessage),
  nextCursor: z.string().nullable(),
});

interface Envelope {
  success: boolean;
  data: unknown;
  message?: string;
  code?: string;
}

describe('Chat controllers (HTTP thật)', () => {
  let app: INestApplication<App>;
  let realtime: FakeRealtimeEmitter;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const fakeMail = createFakeMail();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  interface Account {
    agent: Agent;
    userId: string;
    email: string;
  }

  // Ghi lại mọi status đã thấy trên từng route (theo khuôn đường dẫn Swagger) và mọi body trả về, để đối chiếu với
  // tài liệu ở cuối file và quét rò rỉ định danh.
  const observed = new Map<string, Set<number>>();
  const bodies: string[] = [];

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
    bodies.push(res.text);
    return res;
  }
  const envelope = (res: { body: unknown }) => res.body as Envelope;
  const dataOf = (res: { body: unknown }) => envelope(res).data;

  async function register(suffix: string, verified: boolean): Promise<Account> {
    const agent = newAgent();
    const email = `${TAG}${stamp}${suffix}@test.local`.toLowerCase();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', name: `${TAG}${suffix}` })
      .expect(201);
    if (verified) {
      await prisma.user.update({
        where: { email },
        data: { emailVerifiedAt: new Date() },
      });
    }
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { agent, userId: user.id, email };
  }

  async function createShop(
    ownerId: string,
    suffix: string,
    status: ShopStatus,
  ) {
    const shop = await prisma.shop.create({
      data: {
        ownerId,
        name: `${TAG}shop-${suffix}`,
        slug: `${TAG}shop-${suffix}-${stamp}`,
        status,
      },
      select: { id: true },
    });
    return shop.id;
  }

  const messageCount = (conversationId: string) =>
    prisma.message.count({ where: { conversationId } });
  const sendBody = (content = 'xin chào', clientMessageId = randomUUID()) => ({
    content,
    clientMessageId,
  });

  let guest: Agent;
  let buyer1: Account;
  let buyer2: Account;
  let unverified: Account;
  let sellerA: Account;
  let sellerB: Account;
  let sellerS: Account;
  let sellerP: Account;
  let shopA: string;
  let shopB: string;
  let shopS: string;
  let shopP: string;

  beforeAll(async () => {
    await cleanupByTag(prisma, TAG);
    realtime = createFakeRealtimeEmitter();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMail.provider)
      .overrideProvider(REALTIME_EMITTER)
      .useValue(realtime)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    guest = newAgent();
    buyer1 = await register('buyer1', true);
    buyer2 = await register('buyer2', true);
    unverified = await register('unverified', false);
    sellerA = await register('sellerA', true);
    sellerB = await register('sellerB', true);
    sellerS = await register('sellerS', true);
    sellerP = await register('sellerP', true);
    shopA = await createShop(sellerA.userId, 'a', 'APPROVED');
    shopB = await createShop(sellerB.userId, 'b', 'APPROVED');
    shopS = await createShop(sellerS.userId, 's', 'SUSPENDED');
    shopP = await createShop(sellerP.userId, 'p', 'PENDING');
  });

  beforeEach(() => realtime.reset());

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  // Mọi route chat (khuôn đường dẫn dùng chung với Swagger) — cần cho ma trận 401 và đối chiếu tài liệu.
  const ROUTES: ['get' | 'post', string][] = [
    ['post', '/conversations'],
    ['get', '/conversations'],
    ['get', '/conversations/unread-count'],
    ['get', '/conversations/{id}/messages'],
    ['post', '/conversations/{id}/messages'],
    ['post', '/conversations/{id}/read'],
    ['get', '/shops/{shopId}/conversations'],
    ['get', '/shops/{shopId}/conversations/unread-count'],
    ['get', '/shops/{shopId}/conversations/{id}/messages'],
    ['post', '/shops/{shopId}/conversations/{id}/messages'],
    ['post', '/shops/{shopId}/conversations/{id}/read'],
  ];

  describe('xác thực', () => {
    it.each(ROUTES)(
      'khách chưa đăng nhập: %s %s ⇒ 401',
      async (method, template) => {
        const res = await call(
          guest,
          method,
          template,
          { id: randomUUID(), shopId: shopA },
          { body: method === 'post' ? {} : undefined },
        );

        expect(res.status).toBe(401);
        expect(envelope(res)).toMatchObject({ success: false, data: null });
      },
    );

    it('email chưa xác thực: mở hội thoại và gửi tin ⇒ 403 EMAIL_NOT_VERIFIED; đọc hộp thư thì vẫn được', async () => {
      const open = await call(
        unverified.agent,
        'post',
        '/conversations',
        {},
        {
          body: { shopId: shopA },
        },
      );
      const send = await call(
        unverified.agent,
        'post',
        '/conversations/{id}/messages',
        { id: randomUUID() },
        { body: sendBody() },
      );
      const list = await call(unverified.agent, 'get', '/conversations');
      const unread = await call(
        unverified.agent,
        'get',
        '/conversations/unread-count',
      );

      expect(open.status).toBe(403);
      expect(envelope(open).code).toBe('EMAIL_NOT_VERIFIED');
      expect(send.status).toBe(403);
      expect(envelope(send).code).toBe('EMAIL_NOT_VERIFIED');
      expect(list.status).toBe(200);
      expect(summaryList.parse(dataOf(list)).items).toEqual([]);
      expect(unreadCountSchema.parse(dataOf(unread))).toEqual({
        unreadCount: 0,
      });
    });
  });

  describe('luồng người mua ↔ chủ shop', () => {
    let conversationId: string;
    const firstClientId = randomUUID();

    it('người mua mở hội thoại ⇒ 200, idempotent (mở lại trả cùng hội thoại), chưa có tin nên chưa hiện trong hộp thư', async () => {
      const first = await call(
        buyer1.agent,
        'post',
        '/conversations',
        {},
        {
          body: { shopId: shopA },
        },
      );
      const again = await call(
        buyer1.agent,
        'post',
        '/conversations',
        {},
        {
          body: { shopId: shopA },
        },
      );
      const list = await call(buyer1.agent, 'get', '/conversations');

      expect(first.status).toBe(200);
      const summary = strictSummary.parse(dataOf(first));
      conversationId = summary.id;
      expect(summary).toMatchObject({
        shopId: shopA,
        counterpart: { name: `${TAG}shop-a` },
        lastMessage: null,
        unreadCount: 0,
        isReadOnly: false,
      });
      expect(strictSummary.parse(dataOf(again)).id).toBe(conversationId);
      expect(summaryList.parse(dataOf(list)).items).toEqual([]);
      expect(
        await prisma.conversation.count({ where: { buyerId: buyer1.userId } }),
      ).toBe(1);
    });

    it('người mua gửi tin ⇒ 201 với đúng các trường của hợp đồng; gửi lại cùng clientMessageId ⇒ 200 cùng tin, không thêm hàng', async () => {
      const created = await call(
        buyer1.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        { body: sendBody('Shop còn size M không ạ?', firstClientId) },
      );
      const replay = await call(
        buyer1.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        { body: sendBody('Shop còn size M không ạ?', firstClientId) },
      );

      expect(created.status).toBe(201);
      const message = strictMessage.parse(dataOf(created));
      expect(message).toMatchObject({
        conversationId,
        senderRole: 'BUYER',
        content: 'Shop còn size M không ạ?',
        clientMessageId: firstClientId,
      });
      expect(replay.status).toBe(200);
      expect(strictMessage.parse(dataOf(replay)).id).toBe(message.id);
      expect(await messageCount(conversationId)).toBe(1);
      // Chỉ lần ghi thật mới đẩy sự kiện: một cặp (người mua + chủ shop), không nhân lên khi gửi lại.
      expect(
        realtime.emitted.filter((e) => e.event === 'chat:message'),
      ).toHaveLength(2);
    });

    it('chủ shop thấy hội thoại với TÊN người mua, tin cuối và 1 tin chưa đọc; hộp thư và huy hiệu khớp nhau', async () => {
      const list = await call(
        sellerA.agent,
        'get',
        '/shops/{shopId}/conversations',
        {
          shopId: shopA,
        },
      );
      const unread = await call(
        sellerA.agent,
        'get',
        '/shops/{shopId}/conversations/unread-count',
        { shopId: shopA },
      );

      expect(list.status).toBe(200);
      const [item] = summaryList.parse(dataOf(list)).items;
      expect(item).toMatchObject({
        id: conversationId,
        counterpart: { name: `${TAG}buyer1`, logoUrl: null },
        lastMessage: {
          senderRole: 'BUYER',
          content: 'Shop còn size M không ạ?',
        },
        unreadCount: 1,
      });
      expect(unreadCountSchema.parse(dataOf(unread))).toEqual({
        unreadCount: 1,
      });
      expect(list.headers['cache-control']).toBe('no-store');
    });

    it('chủ shop đọc tin: KHÔNG thấy clientMessageId của người mua; trả lời ⇒ 201 vai SHOP, đẩy chat:message tới cả hai phía', async () => {
      const read = await call(
        sellerA.agent,
        'get',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopA, id: conversationId },
      );
      realtime.reset();
      const reply = await call(
        sellerA.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopA, id: conversationId },
        { body: sendBody('Còn nhé bạn') },
      );

      const [first] = messageList.parse(dataOf(read)).items;
      expect(first.senderRole).toBe('BUYER');
      expect(first.clientMessageId).toBeUndefined();
      expect(reply.status).toBe(201);
      expect(strictMessage.parse(dataOf(reply)).senderRole).toBe('SHOP');
      const pushed = realtime.emitted.filter((e) => e.event === 'chat:message');
      expect(pushed.map((e) => e.userId).sort()).toEqual(
        [buyer1.userId, sellerA.userId].sort(),
      );
      expect(read.headers['cache-control']).toBe('no-store');
    });

    it('cùng clientMessageId nhưng KHÁC người gửi ⇒ vẫn là tin mới (khoá gồm người gửi)', async () => {
      const res = await call(
        sellerA.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopA, id: conversationId },
        { body: sendBody('Dùng lại khoá của người mua', firstClientId) },
      );

      expect(res.status).toBe(201);
      expect(await messageCount(conversationId)).toBe(3);
      // Chủ shop gửi lại đúng tin đó ⇒ 200, trả tin cũ (nhánh replay của route shop), không thêm hàng.
      const replay = await call(
        sellerA.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopA, id: conversationId },
        { body: sendBody('Dùng lại khoá của người mua', firstClientId) },
      );
      expect(replay.status).toBe(200);
      expect(strictMessage.parse(dataOf(replay)).id).toBe(
        strictMessage.parse(dataOf(res)).id,
      );
      expect(await messageCount(conversationId)).toBe(3);
    });

    it('người mua: huy hiệu và hộp thư thấy tin của shop chưa đọc; đánh dấu đã đọc ⇒ 200, về 0, và CHỈ chủ shop nhận chat:read', async () => {
      const before = await call(
        buyer1.agent,
        'get',
        '/conversations/unread-count',
      );
      const list = await call(buyer1.agent, 'get', '/conversations');
      realtime.reset();
      const read = await call(
        buyer1.agent,
        'post',
        '/conversations/{id}/read',
        { id: conversationId },
      );
      const after = await call(
        buyer1.agent,
        'get',
        '/conversations/unread-count',
      );

      expect(unreadCountSchema.parse(dataOf(before)).unreadCount).toBe(2);
      expect(summaryList.parse(dataOf(list)).items[0]).toMatchObject({
        counterpart: { name: `${TAG}shop-a` },
        unreadCount: 2,
        lastMessage: { senderRole: 'SHOP' },
      });
      expect(read.status).toBe(200);
      expect(markReadResultSchema.strict().parse(dataOf(read))).toBeDefined();
      expect(unreadCountSchema.parse(dataOf(after)).unreadCount).toBe(0);
      const events = realtime.emitted.filter((e) => e.event === 'chat:read');
      expect(events.map((e) => e.userId)).toEqual([sellerA.userId]);
    });

    it('đánh dấu lần nữa ⇒ vẫn 200 (idempotent) và KHÔNG đẩy thêm sự kiện', async () => {
      const again = await call(
        buyer1.agent,
        'post',
        '/conversations/{id}/read',
        { id: conversationId },
      );

      expect(again.status).toBe(200);
      expect(realtime.emitted).toEqual([]);
    });

    it('người mua tải lịch sử: thấy clientMessageId trên tin CỦA MÌNH, không thấy của shop', async () => {
      const res = await call(
        buyer1.agent,
        'get',
        '/conversations/{id}/messages',
        { id: conversationId },
        { query: { limit: 2 } },
      );

      const page = messageList.parse(dataOf(res));
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
      for (const item of page.items) {
        expect(item.clientMessageId === undefined).toBe(
          item.senderRole === 'SHOP',
        );
      }
      // Trang kế dùng nextCursor nguyên trạng, ra nốt tin còn lại.
      const next = await call(
        buyer1.agent,
        'get',
        '/conversations/{id}/messages',
        { id: conversationId },
        { query: { limit: 2, before: page.nextCursor ?? '' } },
      );
      expect(messageList.parse(dataOf(next)).items).toHaveLength(1);
      expect(messageList.parse(dataOf(next)).items[0].clientMessageId).toBe(
        firstClientId,
      );
      expect(messageList.parse(dataOf(next)).nextCursor).toBeNull();
    });

    it('MỌI route đọc của cả hai phía trả Cache-Control: no-store (dữ liệu chat là riêng tư, không để trình duyệt/proxy lưu bản sao)', async () => {
      const responses = await Promise.all([
        call(buyer1.agent, 'get', '/conversations'),
        call(buyer1.agent, 'get', '/conversations/unread-count'),
        call(buyer1.agent, 'get', '/conversations/{id}/messages', {
          id: conversationId,
        }),
        call(sellerA.agent, 'get', '/shops/{shopId}/conversations', {
          shopId: shopA,
        }),
        call(
          sellerA.agent,
          'get',
          '/shops/{shopId}/conversations/unread-count',
          {
            shopId: shopA,
          },
        ),
        call(
          sellerA.agent,
          'get',
          '/shops/{shopId}/conversations/{id}/messages',
          {
            shopId: shopA,
            id: conversationId,
          },
        ),
      ]);

      expect(responses.map((r) => r.status)).toEqual([
        200, 200, 200, 200, 200, 200,
      ]);
      expect(responses.map((r) => r.headers['cache-control'])).toEqual(
        Array<string>(6).fill('no-store'),
      );
    });
  });

  describe('dữ liệu gửi lên bị kiểm', () => {
    let conversationId: string;

    beforeAll(async () => {
      const res = await call(
        buyer2.agent,
        'post',
        '/conversations',
        {},
        {
          body: { shopId: shopA },
        },
      );
      conversationId = strictSummary.parse(dataOf(res)).id;
    });

    it.each([
      ['nội dung rỗng', { content: '', clientMessageId: randomUUID() }],
      [
        'toàn khoảng trắng',
        { content: '   \n  ', clientMessageId: randomUUID() },
      ],
      [
        'quá 1000 ký tự',
        { content: 'a'.repeat(1001), clientMessageId: randomUUID() },
      ],
      [
        'có ký tự NUL',
        { content: 'xin\u0000chào', clientMessageId: randomUUID() },
      ],
      [
        'có bidi-override',
        { content: 'xin‮chào', clientMessageId: randomUUID() },
      ],
      [
        'content không phải chuỗi',
        { content: 123, clientMessageId: randomUUID() },
      ],
      ['thiếu content', { clientMessageId: randomUUID() }],
      ['thiếu clientMessageId', { content: 'xin chào' }],
      [
        'clientMessageId không phải UUID',
        { content: 'xin chào', clientMessageId: 'abc' },
      ],
      ['body rỗng', {}],
    ])(
      'gửi tin: %s ⇒ 400 và không có tin nào được ghi',
      async (_name, body) => {
        const res = await call(
          buyer2.agent,
          'post',
          '/conversations/{id}/messages',
          { id: conversationId },
          { body },
        );

        expect(res.status).toBe(400);
        expect(envelope(res)).toMatchObject({ success: false, data: null });
        expect(await messageCount(conversationId)).toBe(0);
      },
    );

    it('trường lạ trong body (senderId, senderRole, createdAt, conversationId...) bị lọc bỏ — không giả mạo được người gửi', async () => {
      const spoofedAt = '2001-01-01T00:00:00.000Z';
      const res = await call(
        buyer2.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        {
          body: {
            ...sendBody('thật ra là người mua'),
            senderId: sellerA.userId,
            senderRole: 'SHOP',
            createdAt: spoofedAt,
            conversationId: randomUUID(),
            shopId: shopB,
          },
        },
      );

      expect(res.status).toBe(201);
      const message = strictMessage.parse(dataOf(res));
      expect(message.senderRole).toBe('BUYER');
      expect(message.conversationId).toBe(conversationId);
      expect(message.createdAt).not.toBe(spoofedAt);
      const row = await prisma.message.findUniqueOrThrow({
        where: { id: message.id },
      });
      expect(row.senderId).toBe(buyer2.userId);
    });

    it.each([
      ['nội dung rỗng', { content: '', clientMessageId: randomUUID() }],
      [
        'quá 1000 ký tự',
        { content: 'a'.repeat(1001), clientMessageId: randomUUID() },
      ],
      [
        'có ký tự NUL',
        { content: 'xin\u0000chào', clientMessageId: randomUUID() },
      ],
      ['thiếu clientMessageId', { content: 'xin chào' }],
      [
        'clientMessageId không phải UUID',
        { content: 'xin chào', clientMessageId: 'abc' },
      ],
      ['body rỗng', {}],
    ])(
      'chủ shop gửi tin: %s ⇒ 400 và không có tin nào được ghi',
      async (_name, body) => {
        const before = await messageCount(conversationId);

        const res = await call(
          sellerA.agent,
          'post',
          '/shops/{shopId}/conversations/{id}/messages',
          { shopId: shopA, id: conversationId },
          { body },
        );

        expect(res.status).toBe(400);
        expect(await messageCount(conversationId)).toBe(before);
      },
    );

    it('chủ shop gửi: shopId trong body không có tác dụng (chỉ tin shopId của đường dẫn đã qua ShopOwnerGuard)', async () => {
      const res = await call(
        sellerA.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopA, id: conversationId },
        { body: { ...sendBody('trả lời'), shopId: shopB } },
      );

      expect(res.status).toBe(201);
      expect(strictMessage.parse(dataOf(res)).conversationId).toBe(
        conversationId,
      );
    });

    it.each([
      ['shopId thiếu', {}],
      ['shopId không phải UUID', { shopId: 'abc' }],
      ['shopId là số', { shopId: 5 }],
    ])('mở hội thoại: %s ⇒ 400', async (_name, body) => {
      const res = await call(
        buyer2.agent,
        'post',
        '/conversations',
        {},
        { body },
      );

      expect(res.status).toBe(400);
    });

    it.each([
      ['limit = 0', { limit: 0 }],
      ['limit vượt trần 50', { limit: 51 }],
      ['limit không phải số', { limit: 'abc' }],
      ['con trỏ sai định dạng', { before: 'khong-hop-le!' }],
      ['con trỏ giả mạo', { before: 'AAAA' }],
    ])(
      'truy vấn phân trang: %s ⇒ 400 ở cả 4 route đọc',
      async (_name, query) => {
        const q = query as Record<string, string | number>;
        const responses = await Promise.all([
          call(buyer2.agent, 'get', '/conversations', {}, { query: q }),
          call(
            buyer2.agent,
            'get',
            '/conversations/{id}/messages',
            { id: conversationId },
            { query: q },
          ),
          call(
            sellerA.agent,
            'get',
            '/shops/{shopId}/conversations',
            { shopId: shopA },
            { query: q },
          ),
          call(
            sellerA.agent,
            'get',
            '/shops/{shopId}/conversations/{id}/messages',
            { shopId: shopA, id: conversationId },
            { query: q },
          ),
        ]);

        expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
      },
    );

    it('limit ở biên 1 và 50 được nhận', async () => {
      const one = await call(
        buyer2.agent,
        'get',
        '/conversations/{id}/messages',
        { id: conversationId },
        { query: { limit: 1 } },
      );
      const fifty = await call(
        buyer2.agent,
        'get',
        '/conversations/{id}/messages',
        { id: conversationId },
        { query: { limit: 50 } },
      );

      expect(one.status).toBe(200);
      expect(fifty.status).toBe(200);
    });
  });

  describe('chống IDOR trên MỌI route theo hội thoại', () => {
    let conversationId: string;
    let messageId: string;

    beforeAll(async () => {
      const open = await call(
        buyer1.agent,
        'post',
        '/conversations',
        {},
        {
          body: { shopId: shopA },
        },
      );
      conversationId = strictSummary.parse(dataOf(open)).id;
      messageId = (
        await prisma.message.findFirstOrThrow({
          where: { conversationId },
          select: { id: true },
        })
      ).id;
    });

    // [mô tả, tác nhân, status mong đợi, dựng yêu cầu]
    type Attempt = [
      string,
      () => Agent,
      number,
      'buyer' | 'seller',
      () => string,
    ];
    const attempts: Attempt[] = [
      [
        'người mua KHÁC qua đường dẫn người mua',
        () => buyer2.agent,
        404,
        'buyer',
        () => shopA,
      ],
      [
        'chủ shop KHÁC qua đường dẫn shop của CHÍNH họ',
        () => sellerB.agent,
        404,
        'seller',
        () => shopB,
      ],
      [
        'chủ shop KHÁC mạo shopId của hội thoại trên đường dẫn',
        () => sellerB.agent,
        403,
        'seller',
        () => shopA,
      ],
      [
        'người mua đi vào đường dẫn shop (shop của hội thoại)',
        () => buyer1.agent,
        403,
        'seller',
        () => shopA,
      ],
      [
        'chủ shop đi vào đường dẫn NGƯỜI MUA (không phải người mua của hội thoại)',
        () => sellerA.agent,
        404,
        'buyer',
        () => shopA,
      ],
    ];

    it.each(attempts)(
      '%s — đọc, gửi và đánh dấu đã đọc đều bị từ chối; dữ liệu không đổi, không có sự kiện',
      async (_name, agent, expected, side, shop) => {
        const marksBefore = await prisma.conversation.findUniqueOrThrow({
          where: { id: conversationId },
        });
        const countBefore = await messageCount(conversationId);
        realtime.reset();
        const prefix =
          side === 'buyer' ? '/conversations' : '/shops/{shopId}/conversations';
        const params = { id: conversationId, shopId: shop() };

        const responses = [
          await call(agent(), 'get', `${prefix}/{id}/messages`, params),
          await call(agent(), 'post', `${prefix}/{id}/messages`, params, {
            body: sendBody('chen vào'),
          }),
          await call(agent(), 'post', `${prefix}/{id}/read`, params),
        ];

        expect(responses.map((r) => r.status)).toEqual([
          expected,
          expected,
          expected,
        ]);
        expect(await messageCount(conversationId)).toBe(countBefore);
        expect(
          await prisma.conversation.findUniqueOrThrow({
            where: { id: conversationId },
          }),
        ).toEqual(marksBefore);
        expect(realtime.emitted).toEqual([]);
      },
    );

    it('hội thoại không tồn tại hoặc id rác ⇒ 404, kể cả với người mua và chủ shop thật', async () => {
      const ids = [randomUUID(), 'khong-phai-uuid', "' OR 1=1 --"];
      for (const id of ids) {
        const buyerSide = await call(
          buyer1.agent,
          'get',
          '/conversations/{id}/messages',
          { id },
        );
        const sellerSide = await call(
          sellerA.agent,
          'post',
          '/shops/{shopId}/conversations/{id}/read',
          { shopId: shopA, id },
        );
        expect(buyerSide.status).toBe(404);
        expect(sellerSide.status).toBe(404);
      }
    });

    it('shop không tồn tại trên đường dẫn shop ⇒ 404 (guard), kể cả khi người gọi là chủ shop khác', async () => {
      const res = await call(
        sellerA.agent,
        'get',
        '/shops/{shopId}/conversations',
        { shopId: randomUUID() },
      );

      expect(res.status).toBe(404);
    });

    it('hộp thư và huy hiệu của người khác luôn rỗng: không thấy hội thoại của người mua 1 / shop A', async () => {
      const outsiders = await Promise.all([
        call(buyer2.agent, 'get', '/conversations'),
        call(sellerB.agent, 'get', '/shops/{shopId}/conversations', {
          shopId: shopB,
        }),
      ]);
      const ids = outsiders.flatMap((r) =>
        summaryList.parse(dataOf(r)).items.map((i) => i.id),
      );

      expect(ids).not.toContain(conversationId);
      // tin của hội thoại cũng không lọt vào bất kỳ response nào của người ngoài
      expect(outsiders.map((r) => r.text).join('')).not.toContain(messageId);
    });
  });

  describe('quy tắc của shop', () => {
    it('chủ shop không nhắn cho shop của chính mình ⇒ 409 CHAT_OWN_SHOP', async () => {
      const res = await call(
        sellerA.agent,
        'post',
        '/conversations',
        {},
        { body: { shopId: shopA } },
      );

      expect(res.status).toBe(409);
      expect(envelope(res).code).toBe('CHAT_OWN_SHOP');
    });

    it('shop chưa được duyệt hoặc không tồn tại ⇒ 404 như trang công khai (không lộ shop nháp)', async () => {
      const pending = await call(
        buyer1.agent,
        'post',
        '/conversations',
        {},
        { body: { shopId: shopP } },
      );
      const missing = await call(
        buyer1.agent,
        'post',
        '/conversations',
        {},
        { body: { shopId: randomUUID() } },
      );

      expect(pending.status).toBe(404);
      expect(missing.status).toBe(404);
    });

    describe('shop bị khoá: hội thoại cũ chỉ đọc', () => {
      let conversationId: string;

      beforeAll(async () => {
        conversationId = (
          await prisma.conversation.create({
            data: { buyerId: buyer1.userId, shopId: shopS },
            select: { id: true },
          })
        ).id;
        const at = new Date(Date.now() - 60_000);
        await prisma.message.create({
          data: {
            conversationId,
            senderId: buyer1.userId,
            content: 'trước khi bị khoá',
            createdAt: at,
          },
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: at },
        });
      });

      it('đọc hộp thư, tải tin và đánh dấu đã đọc vẫn được ở cả hai phía; isReadOnly = true', async () => {
        const buyerList = await call(buyer1.agent, 'get', '/conversations');
        const buyerMessages = await call(
          buyer1.agent,
          'get',
          '/conversations/{id}/messages',
          { id: conversationId },
        );
        const sellerList = await call(
          sellerS.agent,
          'get',
          '/shops/{shopId}/conversations',
          { shopId: shopS },
        );
        const sellerRead = await call(
          sellerS.agent,
          'post',
          '/shops/{shopId}/conversations/{id}/read',
          { shopId: shopS, id: conversationId },
        );

        expect(buyerList.status).toBe(200);
        const mine = summaryList
          .parse(dataOf(buyerList))
          .items.find((i) => i.id === conversationId);
        expect(mine?.isReadOnly).toBe(true);
        expect(messageList.parse(dataOf(buyerMessages)).items).toHaveLength(1);
        expect(summaryList.parse(dataOf(sellerList)).items[0].isReadOnly).toBe(
          true,
        );
        expect(sellerRead.status).toBe(200);
      });

      it('gửi tin ⇒ 409 CHAT_SHOP_UNAVAILABLE ở cả hai phía, không ghi gì', async () => {
        const buyerSend = await call(
          buyer1.agent,
          'post',
          '/conversations/{id}/messages',
          { id: conversationId },
          { body: sendBody() },
        );
        const sellerSend = await call(
          sellerS.agent,
          'post',
          '/shops/{shopId}/conversations/{id}/messages',
          { shopId: shopS, id: conversationId },
          { body: sendBody() },
        );

        expect(buyerSend.status).toBe(409);
        expect(envelope(buyerSend).code).toBe('CHAT_SHOP_UNAVAILABLE');
        expect(sellerSend.status).toBe(409);
        expect(envelope(sellerSend).code).toBe('CHAT_SHOP_UNAVAILABLE');
        expect(await messageCount(conversationId)).toBe(1);
      });
    });
  });

  describe('giới hạn chống lạm dụng, qua HTTP', () => {
    it('người mua gửi 10 tin khi shop chưa trả lời ⇒ tin thứ 11 bị 429 CHAT_AWAITING_REPLY; shop trả lời ⇒ gửi lại được', async () => {
      const buyer = await register('buyer3', true);
      const open = await call(
        buyer.agent,
        'post',
        '/conversations',
        {},
        { body: { shopId: shopB } },
      );
      const conversationId = strictSummary.parse(dataOf(open)).id;
      for (let i = 0; i < 10; i++) {
        const res = await call(
          buyer.agent,
          'post',
          '/conversations/{id}/messages',
          { id: conversationId },
          { body: sendBody(`tin ${i}`) },
        );
        expect(res.status).toBe(201);
      }

      const blocked = await call(
        buyer.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        { body: sendBody('thêm') },
      );
      await call(
        sellerB.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shopB, id: conversationId },
        { body: sendBody('chào bạn') },
      );
      const afterReply = await call(
        buyer.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        { body: sendBody('cảm ơn') },
      );

      expect(blocked.status).toBe(429);
      expect(envelope(blocked)).toMatchObject({
        success: false,
        data: null,
        code: 'CHAT_AWAITING_REPLY',
      });
      expect(afterReply.status).toBe(201);
    });

    it('gửi quá nhanh ⇒ tin thứ 21 trong 30 giây bị 429 CHAT_RATE_LIMITED', async () => {
      const seller = await register('sellerR', true);
      const shop = await createShop(seller.userId, 'r', 'APPROVED');
      const buyer = await register('buyer4', true);
      const open = await call(
        buyer.agent,
        'post',
        '/conversations',
        {},
        { body: { shopId: shop } },
      );
      const conversationId = strictSummary.parse(dataOf(open)).id;
      await call(
        buyer.agent,
        'post',
        '/conversations/{id}/messages',
        { id: conversationId },
        { body: sendBody('chào shop') },
      );
      for (let i = 0; i < 20; i++) {
        const res = await call(
          seller.agent,
          'post',
          '/shops/{shopId}/conversations/{id}/messages',
          { shopId: shop, id: conversationId },
          { body: sendBody(`trả lời ${i}`) },
        );
        expect(res.status).toBe(201);
      }

      const blocked = await call(
        seller.agent,
        'post',
        '/shops/{shopId}/conversations/{id}/messages',
        { shopId: shop, id: conversationId },
        { body: sendBody('quá nhanh') },
      );

      expect(blocked.status).toBe(429);
      expect(envelope(blocked).code).toBe('CHAT_RATE_LIMITED');
    });
  });

  describe('riêng tư của response', () => {
    it('không response nào (kể cả lỗi) chứa email, id người dùng, hay hash — chỉ tên hiển thị', () => {
      const everything = bodies.join('\n');
      const accounts = [
        buyer1,
        buyer2,
        unverified,
        sellerA,
        sellerB,
        sellerS,
        sellerP,
      ];

      expect(everything).not.toContain('@test.local');
      expect(everything).not.toMatch(/password|refreshToken|hash/i);
      for (const account of accounts) {
        expect(everything).not.toContain(account.userId);
      }
    });
  });

  describe('Swagger khớp với hành vi thật', () => {
    it('mọi route chat có tài liệu; status thành công khai báo ĐÚNG bằng status thực quan sát được; mọi status lỗi đã thấy đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('chat').setVersion('0').build(),
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
