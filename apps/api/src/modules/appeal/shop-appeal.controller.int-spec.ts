import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  APPEAL_MESSAGE_MAX_LENGTH,
  ownerAppealSchema,
  shopAppealsResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cleanupByTag } from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho kháng nghị của chủ shop (Week11.md 4.6, D15). Chứng minh điều
// unit test với mock không chứng minh được: ma trận ai được kháng nghị khi nào (chỉ shop bị ADMIN khoá, không phải cascade tài
// khoản), mỗi lần bị khoá chỉ MỘT kháng nghị kể cả khi gửi song song, khoá FOR SHARE chặn kháng nghị gắn vào lần khoá vừa kết
// thúc, mốc bị xử lý lấy từ server, cách ly giữa các shop, các CHECK/UNIQUE ở DB, và lời kháng nghị không vào log/thông báo.
// Chạy: `pnpm test:int`.
const TAG = 'it-shop-appeal-';
const PASSWORD = 'password123';
const fakeMail = createFakeMail();

describe('Kháng nghị của chủ shop (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let counter = 0;

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let adminId: string;
  let anonymous: Agent;
  const startedAt = new Date();

  const observed = { get: new Set<number>(), post: new Set<number>() };

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const urlOf = (shopId: string) => `/api/v1/shops/${shopId}/appeals`;

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function list(agent: Agent, shopId: string) {
    const res = await agent.get(urlOf(shopId));
    observed.get.add(res.status);
    return res;
  }

  async function appeal(agent: Agent, shopId: string, message: unknown) {
    const res = await agent.post(urlOf(shopId)).send({ message });
    observed.post.add(res.status);
    return res;
  }

  // Một chủ shop đăng nhập được (email đã xác thực) kèm một shop APPROVED. `verified: false` để thử cổng email.
  async function newOwner(options: { verified?: boolean } = {}) {
    const n = counter++;
    const email = `${TAG}${stamp}-${n}@test.local`;
    const agent = newAgent();
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: `${TAG}owner${n}` })
      .expect(201);
    const user = await prisma.user.update({
      where: { email },
      data: {
        emailVerifiedAt: options.verified === false ? null : new Date(),
      },
      select: { id: true },
    });
    await loginAs(agent, email);
    const shop = await prisma.shop.create({
      data: {
        ownerId: user.id,
        name: `${TAG}shop${n}`,
        slug: `${TAG}shop-${stamp.toString(36)}-${n}`,
        status: 'APPROVED',
      },
      select: { id: true },
    });
    return { agent, userId: user.id, shopId: shop.id };
  }

  async function setStatus(
    shopId: string,
    status: 'APPROVED' | 'SUSPENDED',
  ): Promise<void> {
    const res = await admin
      .patch(`/api/v1/admin/shops/${shopId}/status`)
      .send({ status, reason: status === 'SUSPENDED' ? 'Bán hàng giả' : '' });
    expect([status, res.status]).toEqual([status, 200]);
  }

  // Shop bị Admin khoá THẬT qua API (có dòng lịch sử actor ADMIN và statusChangedAt thật).
  async function newSuspendedOwner() {
    const owner = await newOwner();
    await setStatus(owner.shopId, 'SUSPENDED');
    return owner;
  }

  const shopOf = (shopId: string) =>
    prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { status: true, statusChangedAt: true },
    });
  const rowsOf = (shopId: string) =>
    prisma.appeal.findMany({
      where: { targetId: shopId },
      orderBy: { moderationEventAt: 'asc' },
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
    // Nghe MỘT LẦN trên cổng ngẫu nhiên (rules/backend.md mục 7): tránh ECONNRESET khi có request song song.
    await app.listen(0);

    const email = `${TAG}${stamp}admin@test.local`;
    await seedAdmin(prisma, { email, password: PASSWORD });
    admin = newAgent();
    await loginAs(admin, email);
    adminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;
    anonymous = newAgent();
  });

  afterEach(() => {
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Thông báo ADMIN_APPEAL_PENDING gửi cả cho Admin THẬT của DB dev (không mang tiền tố test): dọn phần của lượt này.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401 — cả đọc lẫn ghi', async () => {
      const { shopId } = await newSuspendedOwner();

      expect((await list(anonymous, shopId)).status).toBe(401);
      expect((await appeal(anonymous, shopId, 'x')).status).toBe(401);
      expect(await rowsOf(shopId)).toHaveLength(0);
    });

    it('không phải chủ shop 403 (kể cả Admin) — đọc lẫn ghi, và không có kháng nghị nào được tạo', async () => {
      const victim = await newSuspendedOwner();
      const stranger = await newOwner();

      for (const agent of [stranger.agent, admin]) {
        expect((await list(agent, victim.shopId)).status).toBe(403);
        expect((await appeal(agent, victim.shopId, 'xin xem xét')).status).toBe(
          403,
        );
      }
      expect(await rowsOf(victim.shopId)).toHaveLength(0);
    });

    it('shop không tồn tại ⇒ 404', async () => {
      const { agent } = await newOwner();

      expect((await list(agent, randomUUID())).status).toBe(404);
      expect((await appeal(agent, randomUUID(), 'x')).status).toBe(404);
    });

    it('email chưa xác thực: ghi bị chặn 403 EMAIL_NOT_VERIFIED, đọc vẫn được', async () => {
      const owner = await newOwner({ verified: false });
      await setStatus(owner.shopId, 'SUSPENDED');

      const read = await list(owner.agent, owner.shopId);
      const write = await appeal(owner.agent, owner.shopId, 'xin xem xét');

      expect(read.status).toBe(200);
      expect([write.status, code(write)]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
      expect(await rowsOf(owner.shopId)).toHaveLength(0);
    });

    it.each([
      ['thiếu lời kháng nghị', undefined],
      ['rỗng', ''],
      ['chỉ khoảng trắng', '  \n  '],
      ['không phải chuỗi', 123],
      ['quá 1000 ký tự', 'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1)],
      ['có NUL', 'abc\u0000def'],
      ['có ký tự bidi-override', 'abc‮def'],
    ])(
      'ghi: %s ⇒ 400 và không có kháng nghị nào được tạo',
      async (_n, message) => {
        const owner = await newSuspendedOwner();

        const res = await appeal(owner.agent, owner.shopId, message);

        expect(res.status).toBe(400);
        expect(await rowsOf(owner.shopId)).toHaveLength(0);
      },
    );
  });

  describe('ai được kháng nghị khi nào', () => {
    it.each(['APPROVED', 'PENDING', 'REJECTED'] as const)(
      'shop %s ⇒ 409 APPEAL_NOT_ALLOWED và canAppeal=false',
      async (status) => {
        const owner = await newOwner();
        await prisma.shop.update({
          where: { id: owner.shopId },
          data: { status },
        });

        const read = shopAppealsResponseSchema.parse(
          data(await list(owner.agent, owner.shopId)),
        );
        const write = await appeal(owner.agent, owner.shopId, 'xin xem xét');

        expect(read).toEqual({ appeals: [], canAppeal: false });
        expect([write.status, code(write)]).toEqual([
          409,
          'APPEAL_NOT_ALLOWED',
        ]);
        expect(await rowsOf(owner.shopId)).toHaveLength(0);
      },
    );

    it('shop bị khoá theo CASCADE tài khoản (dòng lịch sử do hệ thống ghi) ⇒ 409, canAppeal=false', async () => {
      const owner = await newOwner();
      await prisma.shop.update({
        where: { id: owner.shopId },
        data: { status: 'SUSPENDED', statusChangedAt: new Date() },
      });
      await prisma.shopStatusHistory.create({
        data: {
          shopId: owner.shopId,
          fromStatus: 'APPROVED',
          toStatus: 'SUSPENDED',
          actorType: 'SYSTEM',
          note: 'OWNER_ACCOUNT_SUSPENDED',
        },
      });

      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      const write = await appeal(owner.agent, owner.shopId, 'xin xem xét');

      expect(read.canAppeal).toBe(false);
      expect([write.status, code(write)]).toEqual([409, 'APPEAL_NOT_ALLOWED']);
      expect(await rowsOf(owner.shopId)).toHaveLength(0);
    });

    it('shop bị Admin khoá ⇒ canAppeal=true và gửi được: 201, response parse được, mốc là statusChangedAt THẬT của server', async () => {
      const owner = await newSuspendedOwner();
      const before = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );

      const res = await appeal(
        owner.agent,
        owner.shopId,
        '  Dòng 1\r\nDòng 2  ',
      );

      expect(before).toEqual({ appeals: [], canAppeal: true });
      expect(res.status).toBe(201);
      const created = ownerAppealSchema.parse(data(res));
      expect(created).toMatchObject({
        state: 'PENDING',
        message: 'Dòng 1\nDòng 2',
        decisionNote: null,
        decidedAt: null,
      });
      const shop = await shopOf(owner.shopId);
      const [row] = await rowsOf(owner.shopId);
      expect(row).toMatchObject({
        targetType: 'SHOP',
        targetId: owner.shopId,
        appellantId: owner.userId,
        status: 'PENDING',
        message: 'Dòng 1\nDòng 2',
      });
      expect(row.moderationEventAt.getTime()).toBe(
        shop.statusChangedAt.getTime(),
      );
      expect(created.moderationEventAt).toBe(
        shop.statusChangedAt.toISOString(),
      );
    });

    it('người gửi, đối tượng, trạng thái và mốc KHÔNG đặt được từ body', async () => {
      const owner = await newSuspendedOwner();
      const other = await newOwner();

      const res = await owner.agent.post(urlOf(owner.shopId)).send({
        message: 'xin xem xét',
        appellantId: other.userId,
        targetId: other.shopId,
        targetType: 'PRODUCT',
        status: 'ACCEPTED',
        moderationEventAt: '2020-01-01T00:00:00.000Z',
        decidedById: adminId,
      });
      observed.post.add(res.status);

      expect(res.status).toBe(201);
      const [row] = await rowsOf(owner.shopId);
      expect(row).toMatchObject({
        appellantId: owner.userId,
        targetType: 'SHOP',
        status: 'PENDING',
        decidedById: null,
      });
      expect(row.moderationEventAt.getFullYear()).not.toBe(2020);
      expect(await rowsOf(other.shopId)).toHaveLength(0);
    });

    it('đúng cận 1000 ký tự (kể cả emoji nhiều đơn vị) được ghi nguyên vẹn', async () => {
      const owner = await newSuspendedOwner();
      const message = '😀'.repeat(APPEAL_MESSAGE_MAX_LENGTH / 2);

      const res = await appeal(owner.agent, owner.shopId, message);

      expect(res.status).toBe(201);
      expect((await rowsOf(owner.shopId))[0].message).toBe(message);
    });

    it('chữ như <script> hay "{code}" được lưu và trả NGUYÊN VĂN (hiển thị bằng React, không escape ở BE)', async () => {
      const owner = await newSuspendedOwner();
      const text = '<img src=x onerror=alert(1)> {code} ${x}';

      const res = await appeal(owner.agent, owner.shopId, text);

      expect(res.status).toBe(201);
      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      expect(read.appeals[0].message).toBe(text);
    });
  });

  describe('mỗi lần bị khoá chỉ MỘT kháng nghị', () => {
    it('gửi lần hai trong cùng lần khoá ⇒ 409 APPEAL_ALREADY_SENT, canAppeal=false, chỉ một hàng', async () => {
      const owner = await newSuspendedOwner();
      await appeal(owner.agent, owner.shopId, 'lần một');

      const second = await appeal(owner.agent, owner.shopId, 'lần hai');
      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );

      expect([second.status, code(second)]).toEqual([
        409,
        'APPEAL_ALREADY_SENT',
      ]);
      expect(read.canAppeal).toBe(false);
      expect(await rowsOf(owner.shopId)).toHaveLength(1);
    });

    it('gửi SONG SONG nhiều lần: đúng một 201, còn lại 409 APPEAL_ALREADY_SENT (UNIQUE là trọng tài), đúng một hàng', async () => {
      const owner = await newSuspendedOwner();

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          appeal(owner.agent, owner.shopId, `lần ${index}`),
        ),
      );

      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(
        results.filter((res) => res.status === 409).map((res) => code(res)),
      ).toEqual(Array(5).fill('APPEAL_ALREADY_SENT'));
      expect(await rowsOf(owner.shopId)).toHaveLength(1);
    });

    it('khoá → mở khoá → khoá lại: kháng nghị cũ thành CLOSED và được gửi ĐÚNG MỘT kháng nghị mới cho lần khoá mới', async () => {
      const owner = await newSuspendedOwner();
      await appeal(owner.agent, owner.shopId, 'lần khoá thứ nhất');

      await setStatus(owner.shopId, 'APPROVED');
      const whileOpen = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      await setStatus(owner.shopId, 'SUSPENDED');
      const afterRelock = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      const again = await appeal(owner.agent, owner.shopId, 'lần khoá thứ hai');
      const third = await appeal(owner.agent, owner.shopId, 'lần ba');

      expect(whileOpen.canAppeal).toBe(false);
      expect(whileOpen.appeals.map((item) => item.state)).toEqual(['CLOSED']);
      expect(afterRelock.canAppeal).toBe(true);
      expect(afterRelock.appeals.map((item) => item.state)).toEqual(['CLOSED']);
      expect(again.status).toBe(201);
      expect([third.status, code(third)]).toEqual([409, 'APPEAL_ALREADY_SENT']);

      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      expect(read.appeals.map((item) => [item.message, item.state])).toEqual([
        ['lần khoá thứ hai', 'PENDING'],
        ['lần khoá thứ nhất', 'CLOSED'],
      ]);
      expect(await rowsOf(owner.shopId)).toHaveLength(2);
    });

    // Chứng minh `SELECT ... FOR SHARE`: một giao dịch khác giữ khoá độc quyền hàng shop (như Admin đang mở khoá). Yêu cầu gửi
    // kháng nghị PHẢI chờ khoá đó, rồi đọc lại trạng thái MỚI — không bao giờ gắn kháng nghị vào lần khoá vừa kết thúc.
    it('Admin đang mở khoá shop (giữ khoá hàng) ⇒ yêu cầu kháng nghị chờ, rồi nhận 409 APPEAL_NOT_ALLOWED, không để lại kháng nghị mồ côi', async () => {
      const owner = await newSuspendedOwner();
      let lockTaken!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (lockTaken = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      const unlocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${owner.shopId} FOR UPDATE`;
          lockTaken();
          await released;
          await tx.$executeRaw`UPDATE shops SET status = 'APPROVED', status_changed_at = now() WHERE id = ${owner.shopId}`;
        },
        { timeout: 20_000 },
      );
      await locked;

      const pending = appeal(owner.agent, owner.shopId, 'xin xem xét');
      const state = await Promise.race([
        pending.then(() => 'done'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('blocked'), 700),
        ),
      ]);
      release();
      await unlocker;
      const res = await pending;

      expect(state).toBe('blocked');
      expect([res.status, code(res)]).toEqual([409, 'APPEAL_NOT_ALLOWED']);
      expect(await rowsOf(owner.shopId)).toHaveLength(0);
    });
  });

  describe('kết quả quyết định hiện cho chủ shop', () => {
    it('đã từ chối: thấy ghi chú, trạng thái REJECTED, KHÔNG biết Admin nào; không kháng nghị lại được', async () => {
      const owner = await newSuspendedOwner();
      const created = await appeal(owner.agent, owner.shopId, 'xin xem xét');
      const appealId = (data(created) as { id: string }).id;
      const decided = await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'REJECT', note: 'Giấy tờ chưa hợp lệ' });
      expect(decided.status).toBe(200);

      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );
      const again = await appeal(owner.agent, owner.shopId, 'thử lại');

      expect(read.canAppeal).toBe(false);
      expect(read.appeals[0]).toMatchObject({
        state: 'REJECTED',
        decisionNote: 'Giấy tờ chưa hợp lệ',
      });
      expect(read.appeals[0].decidedAt).not.toBeNull();
      const text = JSON.stringify(read);
      expect(text).not.toContain(adminId);
      expect(text).not.toMatch(/decidedBy|appellantId|targetId/);
      expect([again.status, code(again)]).toEqual([409, 'APPEAL_ALREADY_SENT']);
    });

    it('đã chấp nhận: shop được mở khoá, trạng thái ACCEPTED', async () => {
      const owner = await newSuspendedOwner();
      const created = await appeal(owner.agent, owner.shopId, 'xin xem xét');
      const appealId = (data(created) as { id: string }).id;
      await admin
        .post(`/api/v1/admin/appeals/${appealId}/decide`)
        .send({ decision: 'ACCEPT' })
        .expect(200);

      const read = shopAppealsResponseSchema.parse(
        data(await list(owner.agent, owner.shopId)),
      );

      expect((await shopOf(owner.shopId)).status).toBe('APPROVED');
      expect(read.appeals[0].state).toBe('ACCEPTED');
      expect(read.canAppeal).toBe(false);
    });
  });

  describe('cách ly giữa các shop', () => {
    it('chủ shop A không bao giờ thấy kháng nghị của shop B, và gửi vào shop B là 403', async () => {
      const a = await newSuspendedOwner();
      const b = await newSuspendedOwner();
      await appeal(a.agent, a.shopId, 'của A');
      await appeal(b.agent, b.shopId, 'của B');

      const seenByA = shopAppealsResponseSchema.parse(
        data(await list(a.agent, a.shopId)),
      );
      const crossRead = await list(a.agent, b.shopId);
      const crossWrite = await appeal(a.agent, b.shopId, 'mạo danh');

      expect(seenByA.appeals.map((item) => item.message)).toEqual(['của A']);
      expect(crossRead.status).toBe(403);
      expect(crossWrite.status).toBe(403);
      expect(JSON.stringify(crossRead.body)).not.toContain('của B');
      expect(await rowsOf(b.shopId)).toHaveLength(1);
    });
  });

  describe('thông báo cho Admin', () => {
    it('mọi Admin ACTIVE nhận ADMIN_APPEAL_PENDING chỉ mang id + tên shop — KHÔNG mang lời kháng nghị', async () => {
      const owner = await newSuspendedOwner();
      const message = `CANARY-APPEAL-${randomUUID()}`;
      const created = await appeal(owner.agent, owner.shopId, message);
      const appealId = (data(created) as { id: string }).id;
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: owner.shopId },
        select: { name: true },
      });

      const rows = await prisma.notification.findMany({
        where: { userId: adminId, type: 'ADMIN_APPEAL_PENDING' },
      });

      const mine = rows.filter(
        (row) => (row.data as { appealId?: string }).appealId === appealId,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].data).toEqual({
        appealId,
        shopId: owner.shopId,
        shopName: shop.name,
      });
      expect(JSON.stringify(mine[0].data)).not.toContain(message);
    });

    it('kháng nghị bị từ chối vì đã gửi rồi ⇒ KHÔNG gửi thêm thông báo', async () => {
      const owner = await newSuspendedOwner();
      await appeal(owner.agent, owner.shopId, 'lần một');
      const countFor = () =>
        prisma.notification.count({
          where: {
            userId: adminId,
            type: 'ADMIN_APPEAL_PENDING',
            data: { path: ['shopId'], equals: owner.shopId },
          },
        });
      const before = await countFor();

      await appeal(owner.agent, owner.shopId, 'lần hai');

      expect(before).toBe(1);
      expect(await countFor()).toBe(1);
    });
  });

  describe('ràng buộc ngay ở DB (lưới cuối khi vòng qua Zod bằng SQL thô)', () => {
    const insertRow = (overrides: {
      id?: string;
      message?: string;
      status?: string;
      decidedById?: string | null;
      decidedAt?: Date | null;
      decisionNote?: string | null;
      targetId?: string;
      moderationEventAt?: Date;
    }) => {
      const {
        id = randomUUID(),
        message = 'ok',
        status = 'PENDING',
        decidedById = null,
        decidedAt = null,
        decisionNote = null,
        targetId = randomUUID(),
        moderationEventAt = new Date(),
      } = overrides;
      return prisma.$executeRaw`INSERT INTO appeals
        (id, target_type, target_id, appellant_id, message, status, moderation_event_at, decided_by_id, decided_at, decision_note)
        VALUES (${id}, 'SHOP'::"AppealTargetType", ${targetId}, ${adminId}, ${message}, ${status}::"AppealStatus",
                ${moderationEventAt}, ${decidedById}, ${decidedAt}, ${decisionNote})`;
    };

    it('lời kháng nghị rỗng hoặc quá 1000 ký tự bị từ chối; đúng cận thì qua', async () => {
      await expect(insertRow({ message: '' })).rejects.toThrow(
        /appeals_message_length_in_range/,
      );
      await expect(
        insertRow({ message: 'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1) }),
      ).rejects.toThrow(/appeals_message_length_in_range/);
      await expect(
        insertRow({ message: 'a'.repeat(APPEAL_MESSAGE_MAX_LENGTH) }),
      ).resolves.toBe(1);
    });

    it('còn PENDING mà đã có người quyết định / thời điểm / ghi chú bị từ chối', async () => {
      for (const extra of [
        { decidedById: adminId },
        { decidedAt: new Date() },
        { decisionNote: 'ghi chú' },
      ]) {
        await expect(insertRow(extra)).rejects.toThrow(
          /appeals_status_matches_decision/,
        );
      }
    });

    it('đã ACCEPTED/REJECTED mà thiếu người quyết định hoặc thời điểm bị từ chối', async () => {
      await expect(
        insertRow({ status: 'ACCEPTED', decidedAt: new Date() }),
      ).rejects.toThrow(/appeals_status_matches_decision/);
      await expect(
        insertRow({ status: 'ACCEPTED', decidedById: adminId }),
      ).rejects.toThrow(/appeals_status_matches_decision/);
      await expect(
        insertRow({
          status: 'ACCEPTED',
          decidedById: adminId,
          decidedAt: new Date(),
        }),
      ).resolves.toBe(1);
    });

    it('từ chối mà không có ghi chú bị từ chối', async () => {
      await expect(
        insertRow({
          status: 'REJECTED',
          decidedById: adminId,
          decidedAt: new Date(),
        }),
      ).rejects.toThrow(/appeals_rejection_has_note/);
    });

    it('ghi chú rỗng hoặc quá 500 ký tự bị từ chối', async () => {
      const base = {
        status: 'ACCEPTED',
        decidedById: adminId,
        decidedAt: new Date(),
      };
      await expect(insertRow({ ...base, decisionNote: '' })).rejects.toThrow(
        /appeals_decision_note_length_in_range/,
      );
      await expect(
        insertRow({ ...base, decisionNote: 'a'.repeat(501) }),
      ).rejects.toThrow(/appeals_decision_note_length_in_range/);
    });

    it('hai hàng cùng (loại, đối tượng, mốc) bị từ chối bởi UNIQUE — kể cả khi vòng qua service', async () => {
      const targetId = randomUUID();
      const moderationEventAt = new Date('2026-10-28T10:00:00.000Z');
      await insertRow({ targetId, moderationEventAt });

      await expect(insertRow({ targetId, moderationEventAt })).rejects.toThrow(
        /23505|already exists/,
      );
      await expect(
        insertRow({
          targetId,
          moderationEventAt: new Date('2026-10-29T10:00:00.000Z'),
        }),
      ).resolves.toBe(1);
    });

    it('DB từ chối loại đối tượng lạ (enum Postgres)', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO appeals (id, target_type, target_id, appellant_id, message, moderation_event_at)
          VALUES (${randomUUID()}, 'USER'::"AppealTargetType", ${randomUUID()}, ${randomUUID()}, 'x', now())`,
      ).rejects.toThrow(/invalid input value for enum/);
    });
  });

  describe('log không bao giờ chứa lời kháng nghị', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const owner = await newSuspendedOwner();
      const retryOwner = await newSuspendedOwner();
      const captured: string[] = [];
      const restores: (() => void)[] = [];
      const capture = (chunk: unknown) => {
        captured.push(
          typeof chunk === 'string' ? chunk : JSON.stringify(chunk),
        );
      };
      for (const stream of [process.stdout, process.stderr]) {
        const spy = jest
          .spyOn(stream, 'write')
          .mockImplementation((chunk: unknown) => {
            capture(chunk);
            return true;
          });
        restores.push(() => spy.mockRestore());
      }
      for (const level of [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
        'fatal',
      ] as const) {
        const spy = jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            capture(args);
          });
        restores.push(() => spy.mockRestore());
      }
      const prismaService = app.get(PrismaService);

      let leaky: request.Response;
      let down: request.Response;
      try {
        // 1. luồng thường
        await owner.agent.post(urlOf(owner.shopId)).send({
          message: `${canary} lời kháng nghị thường`,
        });
        await owner.agent.get(urlOf(owner.shopId));
        // 2. sai dữ liệu: quá dài, chứa canary
        await owner.agent.post(urlOf(owner.shopId)).send({
          message: `${canary}${'x'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1)}`,
        });
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả lời kháng nghị)
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { message: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await retryOwner.agent
          .post(urlOf(retryOwner.shopId))
          .send({ message: `${canary} lỗi Prisma` });
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(new Error('db down'));
        down = await retryOwner.agent
          .post(urlOf(retryOwner.shopId))
          .send({ message: `${canary} DB sập` });
      } finally {
        jest.restoreAllMocks();
        restores.forEach((restore) => restore());
      }

      expect(leaky.status).toBe(500);
      expect(down.status).toBe(500);
      expect(JSON.stringify([leaky.body, down.body])).not.toContain(canary);

      const logs = captured.join('\n');
      // Không phải test rỗng: các lỗi cố ý ở trên PHẢI đã để lại dấu vết trong log...
      expect(logs).toContain('db down');
      expect(logs).toContain('details omitted');
      // ...nhưng không có lời kháng nghị.
      expect(logs).not.toContain(canary);
    });
  });

  describe('header và tài liệu API', () => {
    it('GET trả Cache-Control: no-store (dữ liệu riêng tư)', async () => {
      const owner = await newSuspendedOwner();

      const res = await list(owner.agent, owner.shopId);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('Swagger khớp hành vi thật: GET khai báo đúng 200, POST khai báo đúng 201, và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('appeal').setVersion('0').build(),
      );
      const path = document.paths['/api/v1/shops/{shopId}/appeals'] as
        Record<string, { responses: Record<string, unknown> }> | undefined;

      for (const [method, success] of [
        ['get', 200],
        ['post', 201],
      ] as const) {
        const operation = path?.[method];
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([
          success,
        ]);
        // 500 chỉ do test cố ý phá lúc ghi, không phải hành vi cần tài liệu.
        for (const status of [...observed[method]].filter((s) => s !== 500)) {
          expect([method, documented]).toEqual([
            method,
            expect.arrayContaining([status]),
          ]);
        }
      }
      expect([...observed.get].sort()).toEqual([200, 401, 403, 404]);
      expect([...observed.post].filter((s) => s !== 500).sort()).toEqual([
        201, 400, 401, 403, 404, 409,
      ]);
    });
  });
});
