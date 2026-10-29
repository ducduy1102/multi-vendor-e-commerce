import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  APPEAL_DECISION_NOTE_MAX_LENGTH,
  adminAppealListResponseSchema,
  decideAppealResponseSchema,
  type AdminAppeal,
  type AdminAppealListFilter,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AdminAuditService } from '../../shared/audit/admin-audit.service';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createShopWithProduct,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho hàng đợi và quyết định kháng nghị của Admin (Week11.md 4.6, D15).
// Chứng minh điều unit test với mock không chứng minh được: quyền (401/403), bộ lọc/thứ tự/phân trang của hàng đợi trên dữ liệu
// thật (kể cả nhiều kháng nghị CÙNG mili-giây), chấp nhận = mở khoá shop + đóng kháng nghị + nhật ký trong MỘT giao dịch (nhật ký
// lỗi ⇒ rollback cả việc mở khoá), hai Admin quyết định song song chỉ một người thắng, kháng nghị của lần khoá đã kết thúc không
// quyết định được, chủ shop đang bị khoá tài khoản thì không mở khoá được, và lời kháng nghị/ghi chú không vào log. Chạy:
// `pnpm test:int`.
const TAG = 'it-admin-appeals-';
const PASSWORD = 'password123';
const URL = '/api/v1/admin/appeals';
const fakeMail = createFakeMail();

describe('Hàng đợi và quyết định kháng nghị của Admin (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const startedAt = new Date();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let secondAdmin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;
  let adminName: string;
  let secondAdminId: string;

  const observed = { get: new Set<number>(), post: new Set<number>() };

  const data = (res: { body: unknown }) => (res.body as { data: unknown }).data;
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  async function loginAs(agent: Agent, email: string) {
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  async function list(agent: Agent, query: Record<string, string | number>) {
    const res = await agent.get(URL).query(query);
    observed.get.add(res.status);
    return res;
  }

  async function decide(agent: Agent, id: string, body: unknown) {
    const res = await agent.post(`${URL}/${id}/decide`).send(body as object);
    observed.post.add(res.status);
    return res;
  }

  async function setStatus(shopId: string, status: 'APPROVED' | 'SUSPENDED') {
    const res = await admin
      .patch(`/api/v1/admin/shops/${shopId}/status`)
      .send({ status, reason: status === 'SUSPENDED' ? 'Bán hàng giả' : '' });
    expect([status, res.status]).toEqual([status, 200]);
  }

  const shopOf = (shopId: string) =>
    prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { status: true, statusReason: true, statusChangedAt: true },
    });
  const appealOf = (id: string) =>
    prisma.appeal.findUniqueOrThrow({ where: { id } });
  const auditRowsOf = (appealId: string) =>
    prisma.adminAuditLog.findMany({
      where: { action: 'DECIDE_APPEAL', targetId: appealId },
    });
  const notificationsOf = (userId: string) =>
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

  // Shop bị Admin khoá THẬT qua API (có dòng lịch sử actor ADMIN), kèm MỘT kháng nghị PENDING của lần khoá đó.
  async function newPendingAppeal(message = 'Shop đã gỡ hàng bị báo cáo') {
    const base = await createShopWithProduct(prisma, TAG);
    await setStatus(base.shopId, 'SUSPENDED');
    const shop = await shopOf(base.shopId);
    const row = await prisma.appeal.create({
      data: {
        targetType: 'SHOP',
        targetId: base.shopId,
        appellantId: base.ownerId,
        message,
        moderationEventAt: shop.statusChangedAt,
      },
      select: { id: true },
    });
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: base.ownerId },
      select: { email: true },
    });
    return { ...base, appealId: row.id, ownerEmail: owner.email };
  }

  // Dựng thẳng bằng prisma (không qua API) để kiểm soát thời điểm: dùng cho các ca thứ tự/phân trang/bộ lọc.
  async function seedRow(options: {
    state: 'PENDING' | 'CLOSED' | 'ACCEPTED' | 'REJECTED';
    createdAt?: Date;
    decidedAt?: Date;
    message?: string;
  }) {
    const base = await createShopWithProduct(prisma, TAG);
    const episodeAt = new Date('2026-10-20T10:00:00.000Z');
    await prisma.shop.update({
      where: { id: base.shopId },
      data: { status: 'SUSPENDED', statusChangedAt: episodeAt },
    });
    const decided =
      options.state === 'ACCEPTED' || options.state === 'REJECTED';
    const row = await prisma.appeal.create({
      data: {
        targetType: 'SHOP',
        targetId: base.shopId,
        appellantId: base.ownerId,
        message: options.message ?? `lời kháng nghị ${options.state}`,
        // CLOSED = còn PENDING nhưng mốc không còn khớp lần khoá hiện tại của shop.
        moderationEventAt:
          options.state === 'CLOSED'
            ? new Date('2026-10-10T10:00:00.000Z')
            : episodeAt,
        status: options.state === 'CLOSED' ? 'PENDING' : options.state,
        ...(decided
          ? {
              decidedById: adminId,
              decidedAt: options.decidedAt ?? new Date(),
              decisionNote: options.state === 'REJECTED' ? 'Chưa đủ' : null,
            }
          : {}),
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
      select: { id: true },
    });
    return { ...base, appealId: row.id };
  }

  const isMine = (item: AdminAppeal) => item.shop.slug.startsWith(TAG);

  // Duyệt hết các trang của một bộ lọc (giới hạn số trang để không chạy vô hạn) và trả mọi dòng.
  async function collect(status: AdminAppealListFilter, limit = 50) {
    const items: AdminAppeal[] = [];
    for (let page = 1; page <= 200; page++) {
      const res = await list(admin, { status, limit, page });
      const parsed = adminAppealListResponseSchema.parse(data(res));
      items.push(...parsed.items);
      if (page * limit >= parsed.total) break;
    }
    return items;
  }

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
    const adminRow = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, name: true },
    });
    adminId = adminRow.id;
    adminName = adminRow.name;

    const email2 = `${TAG}${stamp}admin2@test.local`;
    await seedAdmin(prisma, { email: email2, password: PASSWORD });
    secondAdmin = newAgent();
    await loginAs(secondAdmin, email2);
    secondAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: email2 },
        select: { id: true },
      })
    ).id;

    plainUser = newAgent();
    const userEmail = `${TAG}${stamp}user@test.local`;
    await plainUser
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password: PASSWORD, name: `${TAG}user` })
      .expect(201);
    await loginAs(plainUser, userEmail);
    anonymous = newAgent();
  });

  afterEach(() => {
    fakeMail.reset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    // Thông báo gửi cả cho Admin THẬT của DB dev (không mang tiền tố test): dọn phần của lượt này.
    await prisma.notification.deleteMany({
      where: { createdAt: { gte: startedAt }, user: { role: 'ADMIN' } },
    });
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401, user thường 403 — cả hàng đợi lẫn quyết định, và kháng nghị không đổi', async () => {
      const { appealId } = await newPendingAppeal();

      expect((await list(anonymous, {})).status).toBe(401);
      expect((await list(plainUser, {})).status).toBe(403);
      for (const agent of [anonymous, plainUser]) {
        const res = await decide(agent, appealId, { decision: 'ACCEPT' });
        expect([401, 403]).toContain(res.status);
      }
      expect((await appealOf(appealId)).status).toBe('PENDING');
    });

    it('chủ shop (không phải Admin) không quyết định được kháng nghị của chính mình', async () => {
      const ownerEmail = `${TAG}${stamp}owner@test.local`;
      const owner = newAgent();
      await owner
        .post('/api/v1/auth/register')
        .send({ email: ownerEmail, password: PASSWORD, name: `${TAG}owner` })
        .expect(201);
      await loginAs(owner, ownerEmail);
      const { appealId, shopId } = await newPendingAppeal();

      const res = await decide(owner, appealId, { decision: 'ACCEPT' });

      expect(res.status).toBe(403);
      expect((await appealOf(appealId)).status).toBe('PENDING');
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
    });

    it.each([
      ['trạng thái lạ', { status: 'ALL' }],
      ['limit quá 50', { limit: 51 }],
      ['limit bằng 0', { limit: 0 }],
      ['page quá trần', { page: 10_001 }],
      ['page tràn số nguyên', { page: '1e21' }],
      ['page âm', { page: -1 }],
    ])('hàng đợi: %s ⇒ 400, không 500', async (_name, query) => {
      expect((await list(admin, query)).status).toBe(400);
    });

    it.each([
      ['thiếu quyết định', {}],
      ['quyết định lạ', { decision: 'APPROVE' }],
      ['từ chối không có ghi chú', { decision: 'REJECT' }],
      ['từ chối với ghi chú rỗng', { decision: 'REJECT', note: '  ' }],
      [
        'ghi chú quá 500 ký tự',
        {
          decision: 'REJECT',
          note: 'a'.repeat(APPEAL_DECISION_NOTE_MAX_LENGTH + 1),
        },
      ],
      ['ghi chú có NUL', { decision: 'REJECT', note: 'abc\u0000def' }],
    ])('quyết định: %s ⇒ 400 và kháng nghị không đổi', async (_name, body) => {
      const { appealId, shopId } = await newPendingAppeal();

      const res = await decide(admin, appealId, body);

      expect(res.status).toBe(400);
      expect((await appealOf(appealId)).status).toBe('PENDING');
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
      expect(await auditRowsOf(appealId)).toHaveLength(0);
    });

    it.each(['not-a-uuid', 'x'.repeat(200), `${randomUUID()}%00`])(
      'id kháng nghị sai dạng (%s) ⇒ 404 APPEAL_NOT_FOUND, không 500',
      async (id) => {
        const res = await decide(admin, id, { decision: 'ACCEPT' });

        expect([res.status, code(res)]).toEqual([404, 'APPEAL_NOT_FOUND']);
      },
    );

    it('id không tồn tại ⇒ cùng một 404, cùng body với id sai dạng', async () => {
      const missing = await decide(admin, randomUUID(), { decision: 'ACCEPT' });
      const malformed = await decide(admin, 'not-a-uuid', {
        decision: 'ACCEPT',
      });

      expect([missing.status, code(missing)]).toEqual([
        404,
        'APPEAL_NOT_FOUND',
      ]);
      expect(missing.body).toEqual(malformed.body);
    });

    it('kháng nghị loại SẢN PHẨM (chưa có luồng quyết định) ⇒ 404, không đụng gì', async () => {
      const row = await prisma.appeal.create({
        data: {
          targetType: 'PRODUCT',
          targetId: randomUUID(),
          appellantId: adminId,
          message: 'kháng nghị sản phẩm',
          moderationEventAt: new Date(),
        },
        select: { id: true },
      });

      const res = await decide(admin, row.id, { decision: 'ACCEPT' });

      expect([res.status, code(res)]).toEqual([404, 'APPEAL_NOT_FOUND']);
      expect((await appealOf(row.id)).status).toBe('PENDING');
      const queue = await collect('PENDING');
      expect(queue.some((item) => item.id === row.id)).toBe(false);
    });
  });

  describe('hàng đợi', () => {
    it('mặc định là PENDING; response parse được bằng schema dùng chung; Cache-Control: no-store', async () => {
      const { appealId } = await newPendingAppeal();

      const res = await list(admin, {});

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = adminAppealListResponseSchema.parse(data(res));
      expect(parsed).toMatchObject({ page: 1, limit: 20 });
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(
        (await collect('PENDING')).some((item) => item.id === appealId),
      ).toBe(true);
    });

    it('mỗi bộ lọc chỉ chứa đúng loại của nó: PENDING / CLOSED / ACCEPTED / REJECTED', async () => {
      const seeded = {
        PENDING: await seedRow({ state: 'PENDING' }),
        CLOSED: await seedRow({ state: 'CLOSED' }),
        ACCEPTED: await seedRow({ state: 'ACCEPTED' }),
        REJECTED: await seedRow({ state: 'REJECTED' }),
      };

      for (const filter of [
        'PENDING',
        'CLOSED',
        'ACCEPTED',
        'REJECTED',
      ] as const) {
        const mine = (await collect(filter)).filter(isMine);
        const ids = mine.map((item) => item.id);
        expect([filter, ids.includes(seeded[filter].appealId)]).toEqual([
          filter,
          true,
        ]);
        for (const other of Object.keys(seeded) as (keyof typeof seeded)[]) {
          if (other !== filter) {
            expect([
              filter,
              other,
              ids.includes(seeded[other].appealId),
            ]).toEqual([filter, other, false]);
          }
        }
        expect(mine.every((item) => item.state === filter)).toBe(true);
      }
    });

    it('PENDING: cũ nhất trước; các bộ lọc còn lại mới nhất trước (ACCEPTED/REJECTED theo ngày quyết định)', async () => {
      const at = (day: number) => new Date(Date.UTC(2026, 9, day, 8, 0, 0));
      const rows = {
        pendingOld: await seedRow({ state: 'PENDING', createdAt: at(1) }),
        pendingNew: await seedRow({ state: 'PENDING', createdAt: at(3) }),
        pendingMid: await seedRow({ state: 'PENDING', createdAt: at(2) }),
        closedOld: await seedRow({ state: 'CLOSED', createdAt: at(1) }),
        closedNew: await seedRow({ state: 'CLOSED', createdAt: at(3) }),
        acceptedOld: await seedRow({ state: 'ACCEPTED', decidedAt: at(4) }),
        acceptedNew: await seedRow({ state: 'ACCEPTED', decidedAt: at(6) }),
        rejectedOld: await seedRow({ state: 'REJECTED', decidedAt: at(5) }),
        rejectedNew: await seedRow({ state: 'REJECTED', decidedAt: at(7) }),
      };
      const orderOf = async (
        filter: AdminAppealListFilter,
        names: (keyof typeof rows)[],
      ) => {
        const ids = (await collect(filter)).filter(isMine).map((i) => i.id);
        return ids.filter((id) => names.some((n) => rows[n].appealId === id));
      };

      expect(
        await orderOf('PENDING', ['pendingOld', 'pendingNew', 'pendingMid']),
      ).toEqual(
        [rows.pendingOld, rows.pendingMid, rows.pendingNew].map(
          (r) => r.appealId,
        ),
      );
      expect(await orderOf('CLOSED', ['closedOld', 'closedNew'])).toEqual(
        [rows.closedNew, rows.closedOld].map((r) => r.appealId),
      );
      expect(await orderOf('ACCEPTED', ['acceptedOld', 'acceptedNew'])).toEqual(
        [rows.acceptedNew, rows.acceptedOld].map((r) => r.appealId),
      );
      expect(await orderOf('REJECTED', ['rejectedOld', 'rejectedNew'])).toEqual(
        [rows.rejectedNew, rows.rejectedOld].map((r) => r.appealId),
      );
    });

    it('nhiều kháng nghị CÙNG mili-giây: phân trang không trùng, không mất, đúng thứ tự (so với thứ tự do chính DB tính)', async () => {
      const sameInstant = new Date('2026-09-01T08:00:00.000Z');
      const created: { appealId: string }[] = [];
      for (let index = 0; index < 5; index++) {
        created.push(
          await seedRow({ state: 'PENDING', createdAt: sameInstant }),
        );
      }
      const ids = created.map((row) => row.appealId);
      const reference = (
        await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM appeals WHERE id IN (${Prisma.join(ids)}) ORDER BY created_at ASC, id ASC`,
        )
      ).map((row) => row.id);

      const walked = (await collect('PENDING', 2))
        .map((item) => item.id)
        .filter((id) => ids.includes(id));

      expect(walked).toHaveLength(5);
      expect(new Set(walked).size).toBe(5);
      expect(walked).toEqual(reference);
    });

    it('total tăng đúng bằng số kháng nghị mới; page/limit được trả nguyên', async () => {
      const before = adminAppealListResponseSchema.parse(
        data(await list(admin, { status: 'PENDING', limit: 1 })),
      );
      await seedRow({ state: 'PENDING' });
      await seedRow({ state: 'PENDING' });

      const after = adminAppealListResponseSchema.parse(
        data(await list(admin, { status: 'PENDING', limit: 1, page: 2 })),
      );

      expect(after.total).toBe(before.total + 2);
      expect(after).toMatchObject({ page: 2, limit: 1 });
      expect(after.items).toHaveLength(1);
    });

    it('mỗi dòng có shop và chủ shop (tên + email) nhưng KHÔNG có SĐT, id người kháng nghị hay id Admin', async () => {
      const { appealId, ownerEmail, shopId } = await newPendingAppeal();
      await decide(admin, appealId, { decision: 'REJECT', note: 'Chưa đủ' });

      const item = (await collect('REJECTED')).find((i) => i.id === appealId);

      expect(item).toBeDefined();
      expect(item).toMatchObject({
        state: 'REJECTED',
        decisionNote: 'Chưa đủ',
        decidedByName: adminName,
        owner: { email: ownerEmail },
        shop: { id: shopId, status: 'SUSPENDED' },
      });
      const text = JSON.stringify(item);
      expect(text).not.toContain(adminId);
      expect(text).not.toMatch(
        /passwordHash|refreshTokenHash|phone|appellantId|decidedById|ownerId/i,
      );
    });
  });

  describe('chấp nhận', () => {
    it('mở khoá shop (SUSPENDED → APPROVED, lý do khoá về null), đóng kháng nghị, ghi nhật ký, báo chủ shop bằng email và thông báo', async () => {
      const { appealId, shopId, ownerId, ownerEmail } =
        await newPendingAppeal();
      const before = await shopOf(shopId);
      const notificationsBefore = (await notificationsOf(ownerId)).length;
      fakeMail.reset();

      const res = await decide(admin, appealId, {
        decision: 'ACCEPT',
        note: 'Đã đủ giấy tờ',
      });

      expect(res.status).toBe(200);
      const { appeal } = decideAppealResponseSchema.parse(data(res));
      expect(appeal).toMatchObject({
        id: appealId,
        state: 'ACCEPTED',
        decisionNote: 'Đã đủ giấy tờ',
        decidedByName: adminName,
        shop: { id: shopId, status: 'APPROVED', statusReason: null },
      });
      const shop = await shopOf(shopId);
      expect(shop).toMatchObject({ status: 'APPROVED', statusReason: null });
      expect(shop.statusChangedAt.getTime()).toBeGreaterThan(
        before.statusChangedAt.getTime(),
      );
      const history = await prisma.shopStatusHistory.findFirstOrThrow({
        where: { shopId },
        orderBy: { createdAt: 'desc' },
      });
      expect(history).toMatchObject({
        fromStatus: 'SUSPENDED',
        toStatus: 'APPROVED',
        actorType: 'ADMIN',
        actorId: adminId,
      });
      expect(await appealOf(appealId)).toMatchObject({
        status: 'ACCEPTED',
        decidedById: adminId,
        decisionNote: 'Đã đủ giấy tờ',
      });

      // Email "trạng thái shop" của luồng duyệt shop + hai thông báo (đổi trạng thái shop, kết quả kháng nghị).
      expect(
        fakeMail.sent.filter((mail) => mail.to === ownerEmail),
      ).toHaveLength(1);
      const notifications = (await notificationsOf(ownerId)).slice(
        notificationsBefore,
      );
      expect(notifications.map((n) => n.type).sort()).toEqual([
        'APPEAL_DECIDED',
        'SHOP_STATUS_CHANGED',
      ]);
      expect(
        notifications.find((n) => n.type === 'APPEAL_DECIDED')?.data,
      ).toEqual({ appealId, shopId, decision: 'ACCEPTED' });
    });

    it('chấp nhận không cần ghi chú: decisionNote null', async () => {
      const { appealId } = await newPendingAppeal();

      const res = await decide(admin, appealId, { decision: 'ACCEPT' });

      expect(res.status).toBe(200);
      expect((await appealOf(appealId)).decisionNote).toBeNull();
    });

    it('nhật ký quản trị DECIDE_APPEAL: đối tượng là KHÁNG NGHỊ, Admin của phiên, lý do là ghi chú, meta chỉ có quyết định + shop, có IP', async () => {
      const { appealId, shopId } = await newPendingAppeal();

      await decide(admin, appealId, {
        decision: 'ACCEPT',
        note: 'Đã đủ giấy tờ',
      });

      const rows = await auditRowsOf(appealId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: adminId,
        action: 'DECIDE_APPEAL',
        targetType: 'APPEAL',
        targetId: appealId,
        reason: 'Đã đủ giấy tờ',
        meta: { decision: 'ACCEPT', shopId },
      });
      expect(rows[0].ip).toMatch(/127\.0\.0\.1|::1/);
    });

    it('chủ shop đang bị khoá tài khoản ⇒ 409 SHOP_OWNER_NOT_ACTIVE: shop vẫn bị khoá, kháng nghị vẫn chờ, không nhật ký, không thông báo; TỪ CHỐI vẫn được', async () => {
      const { appealId, shopId, ownerId } = await newPendingAppeal();
      await prisma.user.update({
        where: { id: ownerId },
        data: { accountStatus: 'SUSPENDED' },
      });
      const notificationsBefore = (await notificationsOf(ownerId)).length;

      const accept = await decide(admin, appealId, { decision: 'ACCEPT' });

      expect([accept.status, code(accept)]).toEqual([
        409,
        'SHOP_OWNER_NOT_ACTIVE',
      ]);
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
      expect((await appealOf(appealId)).status).toBe('PENDING');
      expect(await auditRowsOf(appealId)).toHaveLength(0);
      expect((await notificationsOf(ownerId)).length).toBe(notificationsBefore);

      const reject = await decide(admin, appealId, {
        decision: 'REJECT',
        note: 'Tài khoản đang bị khoá',
      });
      expect(reject.status).toBe(200);
      expect((await appealOf(appealId)).status).toBe('REJECTED');
    });
  });

  describe('từ chối', () => {
    it('shop vẫn bị khoá (không thêm dòng lịch sử), kháng nghị REJECTED kèm ghi chú, báo chủ shop bằng thông báo — KHÔNG email', async () => {
      const { appealId, shopId, ownerId, ownerEmail } =
        await newPendingAppeal();
      const before = await shopOf(shopId);
      const historyBefore = await prisma.shopStatusHistory.count({
        where: { shopId },
      });
      const notificationsBefore = (await notificationsOf(ownerId)).length;
      fakeMail.reset();

      const res = await decide(admin, appealId, {
        decision: 'REJECT',
        note: 'Giấy tờ chưa hợp lệ',
      });

      expect(res.status).toBe(200);
      const { appeal } = decideAppealResponseSchema.parse(data(res));
      expect(appeal).toMatchObject({
        state: 'REJECTED',
        decisionNote: 'Giấy tờ chưa hợp lệ',
        decidedByName: adminName,
        shop: { status: 'SUSPENDED' },
      });
      expect(await shopOf(shopId)).toEqual(before);
      expect(await prisma.shopStatusHistory.count({ where: { shopId } })).toBe(
        historyBefore,
      );
      expect(await appealOf(appealId)).toMatchObject({
        status: 'REJECTED',
        decidedById: adminId,
        decisionNote: 'Giấy tờ chưa hợp lệ',
      });
      expect(
        fakeMail.sent.filter((mail) => mail.to === ownerEmail),
      ).toHaveLength(0);
      const notifications = (await notificationsOf(ownerId)).slice(
        notificationsBefore,
      );
      expect(notifications.map((n) => n.type)).toEqual(['APPEAL_DECIDED']);
      expect(notifications[0].data).toEqual({
        appealId,
        shopId,
        decision: 'REJECTED',
      });
      // Ghi chú chỉ nằm ở response/DB của kháng nghị, KHÔNG trong thông báo.
      expect(JSON.stringify(notifications[0].data)).not.toContain(
        'Giấy tờ chưa hợp lệ',
      );
    });

    it('nhật ký có lý do là ghi chú từ chối', async () => {
      const { appealId } = await newPendingAppeal();

      await decide(admin, appealId, { decision: 'REJECT', note: 'Chưa đủ' });

      const [row] = await auditRowsOf(appealId);
      expect(row).toMatchObject({
        reason: 'Chưa đủ',
        meta: { decision: 'REJECT' },
      });
    });
  });

  describe('chỉ quyết định MỘT lần', () => {
    it('quyết định lần hai ⇒ 409 APPEAL_ALREADY_DECIDED, kết quả đầu không đổi, chỉ một dòng nhật ký', async () => {
      const { appealId, shopId } = await newPendingAppeal();
      await decide(admin, appealId, { decision: 'REJECT', note: 'Chưa đủ' });

      for (const decision of [
        { decision: 'ACCEPT' },
        { decision: 'REJECT', note: 'Lại từ chối' },
      ]) {
        const again = await decide(secondAdmin, appealId, decision);
        expect([again.status, code(again)]).toEqual([
          409,
          'APPEAL_ALREADY_DECIDED',
        ]);
      }

      expect(await appealOf(appealId)).toMatchObject({
        status: 'REJECTED',
        decidedById: adminId,
        decisionNote: 'Chưa đủ',
      });
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
      expect(await auditRowsOf(appealId)).toHaveLength(1);
    });

    it('hai Admin quyết định SONG SONG: đúng một người thắng, người kia nhận 409; luôn nhất quán giữa kháng nghị, shop và nhật ký', async () => {
      for (let round = 0; round < 4; round++) {
        const { appealId, shopId } = await newPendingAppeal();

        const [first, second] = await Promise.all([
          decide(admin, appealId, { decision: 'ACCEPT' }),
          decide(secondAdmin, appealId, {
            decision: 'REJECT',
            note: 'Từ chối song song',
          }),
        ]);

        const statuses = [first.status, second.status].sort();
        expect([round, statuses]).toEqual([round, [200, 409]]);
        const loser = first.status === 409 ? first : second;
        expect(code(loser)).toBe('APPEAL_ALREADY_DECIDED');
        const winnerIsAccept = first.status === 200;
        const row = await appealOf(appealId);
        expect(row.status).toBe(winnerIsAccept ? 'ACCEPTED' : 'REJECTED');
        expect(row.decidedById).toBe(winnerIsAccept ? adminId : secondAdminId);
        expect((await shopOf(shopId)).status).toBe(
          winnerIsAccept ? 'APPROVED' : 'SUSPENDED',
        );
        expect(await auditRowsOf(appealId)).toHaveLength(1);
      }
    });

    it('hai Admin cùng CHẤP NHẬN song song: shop chỉ được mở khoá một lần (một dòng lịch sử SUSPENDED → APPROVED)', async () => {
      const { appealId, shopId } = await newPendingAppeal();

      const results = await Promise.all([
        decide(admin, appealId, { decision: 'ACCEPT' }),
        decide(secondAdmin, appealId, { decision: 'ACCEPT' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.shopStatusHistory.count({
          where: { shopId, fromStatus: 'SUSPENDED', toStatus: 'APPROVED' },
        }),
      ).toBe(1);
    });
  });

  describe('kháng nghị của lần khoá đã kết thúc', () => {
    it('shop được mở khoá bằng đường khác ⇒ kháng nghị thành CLOSED và quyết định bị 409 APPEAL_TARGET_CHANGED, không đổi gì', async () => {
      const { appealId, shopId } = await newPendingAppeal();
      await setStatus(shopId, 'APPROVED');
      const shopBefore = await shopOf(shopId);

      const res = await decide(admin, appealId, { decision: 'ACCEPT' });

      expect([res.status, code(res)]).toEqual([409, 'APPEAL_TARGET_CHANGED']);
      expect((await appealOf(appealId)).status).toBe('PENDING');
      expect(await shopOf(shopId)).toEqual(shopBefore);
      expect(await auditRowsOf(appealId)).toHaveLength(0);
      const closed = (await collect('CLOSED')).map((item) => item.id);
      const pending = (await collect('PENDING')).map((item) => item.id);
      expect(closed).toContain(appealId);
      expect(pending).not.toContain(appealId);
    });

    it('shop bị khoá lại một lần khác: kháng nghị CŨ không mở khoá được lần khoá MỚI (kể cả từ chối cũng 409)', async () => {
      const { appealId, shopId } = await newPendingAppeal();
      await setStatus(shopId, 'APPROVED');
      await setStatus(shopId, 'SUSPENDED');

      const accept = await decide(admin, appealId, { decision: 'ACCEPT' });
      const reject = await decide(admin, appealId, {
        decision: 'REJECT',
        note: 'x',
      });

      for (const res of [accept, reject]) {
        expect([res.status, code(res)]).toEqual([409, 'APPEAL_TARGET_CHANGED']);
      }
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
      expect((await appealOf(appealId)).status).toBe('PENDING');
    });
  });

  describe('tính nguyên tử và thất bại có kiểm soát', () => {
    it('ghi nhật ký lỗi ⇒ 500 và ROLLBACK cả việc mở khoá shop, đóng kháng nghị; không email, không thông báo; thử lại sau đó thành công', async () => {
      const { appealId, shopId, ownerId, ownerEmail } =
        await newPendingAppeal();
      const notificationsBefore = (await notificationsOf(ownerId)).length;
      fakeMail.reset();
      jest
        .spyOn(app.get(AdminAuditService, { strict: false }), 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const failed = await decide(admin, appealId, { decision: 'ACCEPT' });

      expect(failed.status).toBe(500);
      expect((await shopOf(shopId)).status).toBe('SUSPENDED');
      expect((await appealOf(appealId)).status).toBe('PENDING');
      expect(await auditRowsOf(appealId)).toHaveLength(0);
      expect(
        fakeMail.sent.filter((mail) => mail.to === ownerEmail),
      ).toHaveLength(0);
      expect((await notificationsOf(ownerId)).length).toBe(notificationsBefore);

      const retry = await decide(admin, appealId, { decision: 'ACCEPT' });
      expect(retry.status).toBe(200);
      expect((await shopOf(shopId)).status).toBe('APPROVED');
    });

    it('email lỗi không làm hỏng quyết định (side-effect SAU commit): vẫn 200, kháng nghị đã ACCEPTED', async () => {
      const { appealId, shopId } = await newPendingAppeal();
      fakeMail.failWith(new Error('Resend down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const res = await decide(admin, appealId, { decision: 'ACCEPT' });

      expect(res.status).toBe(200);
      expect((await appealOf(appealId)).status).toBe('ACCEPTED');
      expect((await shopOf(shopId)).status).toBe('APPROVED');
    });
  });

  describe('log không bao giờ chứa ghi chú quyết định', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const normal = await newPendingAppeal();
      const leakyCase = await newPendingAppeal();
      const downCase = await newPendingAppeal();
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
        await admin
          .post(`${URL}/${normal.appealId}/decide`)
          .send({ decision: 'REJECT', note: `${canary} ghi chú thường` });
        await admin.get(URL).query({ status: 'REJECTED' });
        // 2. sai dữ liệu: ghi chú quá dài chứa canary
        await admin.post(`${URL}/${leakyCase.appealId}/decide`).send({
          decision: 'REJECT',
          note: `${canary}${'x'.repeat(APPEAL_DECISION_NOTE_MAX_LENGTH + 1)}`,
        });
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả ghi chú)
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { decisionNote: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await admin
          .post(`${URL}/${leakyCase.appealId}/decide`)
          .send({ decision: 'REJECT', note: `${canary} lỗi Prisma` });
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService, '$transaction')
          .mockRejectedValueOnce(new Error('db down'));
        down = await admin
          .post(`${URL}/${downCase.appealId}/decide`)
          .send({ decision: 'REJECT', note: `${canary} DB sập` });
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
      // ...nhưng không có ghi chú.
      expect(logs).not.toContain(canary);
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: hàng đợi khai báo đúng 200, quyết định khai báo đúng 200, và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin').setVersion('0').build(),
      );
      const paths = document.paths as Record<
        string,
        Record<string, { responses: Record<string, unknown> }> | undefined
      >;

      for (const [method, path, seen] of [
        ['get', '/api/v1/admin/appeals', observed.get],
        ['post', '/api/v1/admin/appeals/{id}/decide', observed.post],
      ] as const) {
        const operation = paths[path]?.[method];
        expect(operation).toBeDefined();
        const documented = Object.keys(operation?.responses ?? {}).map(Number);
        expect(documented.filter((s) => s >= 200 && s < 300)).toEqual([200]);
        // 500 chỉ do test cố ý phá, không phải hành vi cần tài liệu.
        for (const status of [...seen].filter((s) => s !== 500)) {
          expect([method, documented]).toEqual([
            method,
            expect.arrayContaining([status]),
          ]);
        }
      }
      expect([...observed.get].sort()).toEqual([200, 400, 401, 403]);
      expect([...observed.post].filter((s) => s !== 500).sort()).toEqual([
        200, 400, 401, 403, 404, 409,
      ]);
    });
  });
});
