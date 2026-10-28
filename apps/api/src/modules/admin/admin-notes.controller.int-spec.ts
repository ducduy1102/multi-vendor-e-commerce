import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ADMIN_NOTE_CONTENT_MAX_LENGTH,
  adminNoteCreatedResponseSchema,
  adminNoteListResponseSchema,
} from '@ecommerce/types';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../../shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../../shared/mail/mail-provider.interface';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  cleanupByTag,
  createShopWithProduct,
  createUser,
} from '../../shared/testing/db-fixtures';
import { createFakeMail } from '../../shared/testing/fake-mail';
import { seedAdmin } from '../../../prisma/seed-admin';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho ghi chú nội bộ của Admin (Week11.md 4.3). Chứng minh điều unit
// test với mock không chứng minh được: quyền (401/403), validate, đối tượng không tồn tại, tác giả luôn là Admin của phiên,
// thứ tự mới nhất trước kể cả khi nhiều ghi chú CÙNG mili-giây (id là khoá phụ), cách ly giữa các đối tượng, bảng chỉ thêm ngay
// ở DB (trigger) cùng các CHECK, ghi chú KHÔNG lọt vào response của bất kỳ route nào ngoài /admin/notes, và nội dung ghi chú
// không vào log kể cả khi ghi lỗi. Chạy: `pnpm test:int`.
const TAG = 'it-admin-notes-';
const PASSWORD = 'password123';
const URL = '/api/v1/admin/notes';

const fakeMail = createFakeMail();

describe('Ghi chú nội bộ của Admin (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();

  const newAgent = () => request.agent(app.getHttpServer());
  type Agent = ReturnType<typeof newAgent>;
  let admin: Agent;
  let plainUser: Agent;
  let anonymous: Agent;
  let adminId: string;
  let adminName: string;

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

  async function add(agent: Agent, body: Record<string, unknown>) {
    const res = await agent.post(URL).send(body);
    observed.post.add(res.status);
    return res;
  }

  async function newShop() {
    const base = await createShopWithProduct(prisma, TAG);
    return base.shopId;
  }

  async function newUserId() {
    return (await createUser(prisma, TAG)).id;
  }

  const rowsOf = (targetId: string) =>
    prisma.adminNote.findMany({ where: { targetId } });

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
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('quyền và dữ liệu vào', () => {
    it('chưa đăng nhập 401, user thường 403 — cả đọc lẫn ghi, và không có ghi chú nào được tạo', async () => {
      const shopId = await newShop();
      const body = { targetType: 'SHOP', targetId: shopId, content: 'x' };
      const query = { targetType: 'SHOP', targetId: shopId };

      expect((await list(anonymous, query)).status).toBe(401);
      expect((await add(anonymous, body)).status).toBe(401);
      expect((await list(plainUser, query)).status).toBe(403);
      expect((await add(plainUser, body)).status).toBe(403);

      expect(await rowsOf(shopId)).toHaveLength(0);
    });

    it.each([
      ['thiếu cả hai', {}],
      ['thiếu targetId', { targetType: 'USER' }],
      ['thiếu targetType', { targetId: randomUUID() }],
      ['loại đối tượng lạ', { targetType: 'PRODUCT', targetId: randomUUID() }],
      ['id không phải UUID', { targetType: 'USER', targetId: 'not-a-uuid' }],
      ['id có NUL', { targetType: 'USER', targetId: `${randomUUID()}%00` }],
      [
        'limit quá 50',
        { targetType: 'USER', targetId: randomUUID(), limit: 51 },
      ],
      [
        'page quá trần',
        { targetType: 'USER', targetId: randomUUID(), page: 10_001 },
      ],
      [
        'page tràn số nguyên',
        { targetType: 'USER', targetId: randomUUID(), page: '1e21' },
      ],
    ])('đọc: %s ⇒ 400, không 500', async (_name, query) => {
      const res = await list(admin, query);

      expect(res.status).toBe(400);
    });

    it.each([
      ['nội dung rỗng', { content: '' }],
      ['chỉ khoảng trắng', { content: '  \n  ' }],
      ['thiếu nội dung', { content: undefined }],
      [
        'quá 1000 ký tự',
        { content: 'a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH + 1) },
      ],
      ['có NUL', { content: 'abc\u0000def' }],
      ['có ký tự bidi-override', { content: 'abc‮def' }],
      ['loại đối tượng lạ', { targetType: 'PRODUCT' }],
      ['id không phải UUID', { targetId: 'not-a-uuid' }],
      ['id có NUL', { targetId: `${randomUUID()}\u0000` }],
    ])(
      'ghi: %s ⇒ 400 và không có ghi chú nào được tạo',
      async (_name, override) => {
        const userId = await newUserId();
        const before = await prisma.adminNote.count();

        const res = await add(admin, {
          targetType: 'USER',
          targetId: userId,
          content: 'hợp lệ',
          ...override,
        });

        expect(res.status).toBe(400);
        expect(await prisma.adminNote.count()).toBe(before);
      },
    );

    it('đối tượng không tồn tại ⇒ cùng một 404 ADMIN_NOTE_TARGET_NOT_FOUND (đọc lẫn ghi, USER lẫn SHOP), không ghi gì', async () => {
      const missing = randomUUID();
      const before = await prisma.adminNote.count();

      for (const targetType of ['USER', 'SHOP']) {
        const read = await list(admin, { targetType, targetId: missing });
        const write = await add(admin, {
          targetType,
          targetId: missing,
          content: 'x',
        });
        expect([targetType, read.status, code(read)]).toEqual([
          targetType,
          404,
          'ADMIN_NOTE_TARGET_NOT_FOUND',
        ]);
        expect([targetType, write.status, code(write)]).toEqual([
          targetType,
          404,
          'ADMIN_NOTE_TARGET_NOT_FOUND',
        ]);
      }
      expect(await prisma.adminNote.count()).toBe(before);
    });

    it('sai LOẠI đối tượng (id của người dùng nhưng khai là SHOP, và ngược lại) ⇒ 404, không ghi chú nhầm chỗ', async () => {
      const userId = await newUserId();
      const shopId = await newShop();

      for (const [targetType, targetId] of [
        ['SHOP', userId],
        ['USER', shopId],
      ]) {
        const res = await add(admin, { targetType, targetId, content: 'x' });
        expect(res.status).toBe(404);
      }
      expect(await rowsOf(userId)).toHaveLength(0);
      expect(await rowsOf(shopId)).toHaveLength(0);
    });
  });

  describe('thêm và đọc', () => {
    it('ghi chú mới: 201, tác giả là Admin của PHIÊN (body không đặt được), nội dung được chuẩn hoá, response parse được', async () => {
      const shopId = await newShop();

      const res = await add(admin, {
        targetType: 'SHOP',
        targetId: shopId,
        content: '  Dòng 1\r\nDòng 2  ',
        // Hai trường dưới KHÔNG được tôn trọng: tác giả và thời điểm do server quyết định.
        authorId: randomUUID(),
        createdAt: '2020-01-01T00:00:00.000Z',
      });

      expect(res.status).toBe(201);
      const { note } = adminNoteCreatedResponseSchema.parse(data(res));
      expect(note).toMatchObject({
        targetType: 'SHOP',
        targetId: shopId,
        content: 'Dòng 1\nDòng 2',
        authorId: adminId,
        authorName: adminName,
      });
      expect(new Date(note.createdAt).getFullYear()).not.toBe(2020);
      const [stored] = await rowsOf(shopId);
      expect(stored).toMatchObject({
        authorId: adminId,
        content: 'Dòng 1\nDòng 2',
      });
    });

    it('đúng cận 1000 ký tự (và emoji nhiều đơn vị) được ghi nguyên vẹn', async () => {
      const userId = await newUserId();
      const content = '😀'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH / 2);

      const res = await add(admin, {
        targetType: 'USER',
        targetId: userId,
        content,
      });

      expect(res.status).toBe(201);
      expect((await rowsOf(userId))[0].content).toBe(content);
    });

    it('chữ như <script> hay "{code}" được lưu và trả NGUYÊN VĂN (hiển thị bằng React, không escape ở BE)', async () => {
      const userId = await newUserId();
      const text = '<img src=x onerror=alert(1)> {code} ${x}';

      const res = await add(admin, {
        targetType: 'USER',
        targetId: userId,
        content: text,
      });

      expect(res.status).toBe(201);
      const listed = adminNoteListResponseSchema.parse(
        data(await list(admin, { targetType: 'USER', targetId: userId })),
      );
      expect(listed.items[0].content).toBe(text);
    });

    it('danh sách: mới nhất trước, total/page/limit đúng, parse được bằng schema dùng chung, Cache-Control: no-store', async () => {
      const shopId = await newShop();
      for (const content of ['một', 'hai', 'ba']) {
        await add(admin, { targetType: 'SHOP', targetId: shopId, content });
      }

      const res = await list(admin, {
        targetType: 'SHOP',
        targetId: shopId,
        limit: 2,
      });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = adminNoteListResponseSchema.parse(data(res));
      expect(parsed).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(parsed.items.map((item) => item.content)).toEqual(['ba', 'hai']);

      const second = adminNoteListResponseSchema.parse(
        data(
          await list(admin, {
            targetType: 'SHOP',
            targetId: shopId,
            limit: 2,
            page: 2,
          }),
        ),
      );
      expect(second.items.map((item) => item.content)).toEqual(['một']);
    });

    it('đối tượng chưa có ghi chú nào ⇒ 200 với danh sách rỗng (khác đối tượng không tồn tại ⇒ 404)', async () => {
      const userId = await newUserId();

      const res = await list(admin, { targetType: 'USER', targetId: userId });

      expect(res.status).toBe(200);
      expect(data(res)).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });

    it('cách ly: ghi chú của đối tượng này không bao giờ hiện ở đối tượng khác', async () => {
      const shopA = await newShop();
      const shopB = await newShop();
      const user = await newUserId();
      await add(admin, {
        targetType: 'SHOP',
        targetId: shopA,
        content: 'của A',
      });
      await add(admin, {
        targetType: 'SHOP',
        targetId: shopB,
        content: 'của B',
      });
      await add(admin, {
        targetType: 'USER',
        targetId: user,
        content: 'của U',
      });

      const texts = async (targetType: string, targetId: string) =>
        adminNoteListResponseSchema
          .parse(data(await list(admin, { targetType, targetId })))
          .items.map((item) => item.content);

      expect(await texts('SHOP', shopA)).toEqual(['của A']);
      expect(await texts('SHOP', shopB)).toEqual(['của B']);
      expect(await texts('USER', user)).toEqual(['của U']);
    });

    // Khoá phụ `id` của orderBy được KHOÁ bằng unit test (admin-notes.service.spec.ts); test này kiểm HÀNH VI. Phá thử cho thấy
    // bỏ khoá phụ vẫn qua ở đây: chỉ mục (…, created_at DESC, id DESC) khiến planner trả đúng thứ tự dù thiếu khoá phụ — nên
    // bài này một mình không đủ để bắt lỗi đó, và cũng không được dùng làm bằng chứng cho khoá phụ.
    it('nhiều ghi chú CÙNG mili-giây: phân trang không trùng, không mất, đúng thứ tự (so với thứ tự do chính DB tính)', async () => {
      const shopId = await newShop();
      const sameInstant = new Date('2026-10-28T10:00:00.000Z');
      await prisma.adminNote.createMany({
        data: Array.from({ length: 60 }, (_, index) => ({
          targetType: 'SHOP' as const,
          targetId: shopId,
          authorId: adminId,
          content: `ghi chú ${index}`,
          createdAt: sameInstant,
        })),
      });
      const reference = (
        await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM admin_notes WHERE target_id = ${shopId} ORDER BY created_at DESC, id DESC`,
        )
      ).map((row) => row.id);

      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await list(admin, {
          targetType: 'SHOP',
          targetId: shopId,
          limit: 25,
          page,
        });
        ids.push(
          ...adminNoteListResponseSchema
            .parse(data(res))
            .items.map((item) => item.id),
        );
      }

      expect(ids).toHaveLength(60);
      expect(new Set(ids).size).toBe(60);
      expect(ids).toEqual(reference);
    });

    it('tên tác giả: lấy theo từng ghi chú; tác giả không còn tài khoản ⇒ authorName null', async () => {
      const userId = await newUserId();
      const otherAuthor = await newUserId();
      const ghostAuthor = randomUUID();
      await prisma.adminNote.createMany({
        data: [
          { authorId: adminId, content: 'từ Admin 1' },
          { authorId: otherAuthor, content: 'từ Admin 2' },
          { authorId: ghostAuthor, content: 'từ Admin đã bị xoá' },
        ].map((note, index) => ({
          targetType: 'USER' as const,
          targetId: userId,
          createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0, index)),
          ...note,
        })),
      });

      const parsed = adminNoteListResponseSchema.parse(
        data(await list(admin, { targetType: 'USER', targetId: userId })),
      );

      expect(
        parsed.items.map((item) => [item.content, item.authorName]),
      ).toEqual([
        ['từ Admin đã bị xoá', null],
        ['từ Admin 2', `${TAG}user`],
        ['từ Admin 1', adminName],
      ]);
    });

    it('response không bao giờ có email hay hash của tác giả', async () => {
      const userId = await newUserId();
      await add(admin, { targetType: 'USER', targetId: userId, content: 'x' });
      const adminEmail = (
        await prisma.user.findUniqueOrThrow({
          where: { id: adminId },
          select: { email: true },
        })
      ).email;

      const res = await list(admin, { targetType: 'USER', targetId: userId });

      const text = JSON.stringify(res.body);
      expect(text).not.toContain(adminEmail);
      expect(text).not.toMatch(/passwordHash|refreshTokenHash|email/i);
    });
  });

  describe('bảng chỉ thêm và các ràng buộc ngay ở DB', () => {
    async function seedOne() {
      const userId = await newUserId();
      const note = await prisma.adminNote.create({
        data: {
          targetType: 'USER',
          targetId: userId,
          authorId: adminId,
          content: 'gốc',
        },
        select: { id: true },
      });
      return { userId, id: note.id };
    }

    it('UPDATE bị từ chối ở DB (cả câu SQL thô lẫn Prisma), nội dung không đổi', async () => {
      const { id } = await seedOne();

      await expect(
        prisma.$executeRaw`UPDATE admin_notes SET content = 'sửa' WHERE id = ${id}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.adminNote.update({ where: { id }, data: { content: 'sửa' } }),
      ).rejects.toThrow(/append-only/);

      const stored = await prisma.adminNote.findUniqueOrThrow({
        where: { id },
      });
      expect(stored.content).toBe('gốc');
    });

    it('DELETE bị từ chối ở DB (SQL thô lẫn Prisma), hàng còn nguyên', async () => {
      const { id } = await seedOne();

      await expect(
        prisma.$executeRaw`DELETE FROM admin_notes WHERE id = ${id}`,
      ).rejects.toThrow(/append-only/);
      await expect(prisma.adminNote.delete({ where: { id } })).rejects.toThrow(
        /append-only/,
      );

      expect(await prisma.adminNote.count({ where: { id } })).toBe(1);
    });

    it('TRUNCATE bị từ chối ở DB', async () => {
      await seedOne();

      await expect(
        prisma.$executeRawUnsafe('TRUNCATE TABLE admin_notes'),
      ).rejects.toThrow(/append-only/);
    });

    it('CHECK ở DB chặn dữ liệu rỗng / quá dài kể cả khi vòng qua Zod bằng SQL thô', async () => {
      const userId = await newUserId();
      const insert = (
        content: string,
        targetId: string = userId,
        authorId: string = adminId,
      ) =>
        prisma.$executeRaw`INSERT INTO admin_notes (id, target_type, target_id, author_id, content)
          VALUES (${randomUUID()}, 'USER'::"AdminNoteTargetType", ${targetId}, ${authorId}, ${content})`;

      await expect(insert('')).rejects.toThrow(
        /admin_notes_content_length_in_range/,
      );
      await expect(
        insert('a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH + 1)),
      ).rejects.toThrow(/admin_notes_content_length_in_range/);
      await expect(insert('ok', 'x'.repeat(65))).rejects.toThrow(
        /admin_notes_target_id_length_in_range/,
      );
      await expect(insert('ok', userId, 'x'.repeat(65))).rejects.toThrow(
        /admin_notes_author_id_length_in_range/,
      );
      // Đúng cận thì qua.
      await expect(
        insert('a'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH)),
      ).resolves.toBe(1);
    });

    it('DB từ chối loại đối tượng lạ (enum Postgres)', async () => {
      const userId = await newUserId();

      await expect(
        prisma.$executeRaw`INSERT INTO admin_notes (id, target_type, target_id, author_id, content)
          VALUES (${randomUUID()}, 'PRODUCT'::"AdminNoteTargetType", ${userId}, ${adminId}, 'x')`,
      ).rejects.toThrow(/invalid input value for enum/);
    });

    it('giờ ghi do ĐỒNG HỒ DB đóng dấu (UTC), tăng dần theo thứ tự ghi', async () => {
      const shopId = await newShop();
      for (const content of ['a', 'b', 'c']) {
        await add(admin, { targetType: 'SHOP', targetId: shopId, content });
      }

      const rows = await prisma.adminNote.findMany({
        where: { targetId: shopId },
        orderBy: { createdAt: 'asc' },
      });

      expect(rows.map((row) => row.content)).toEqual(['a', 'b', 'c']);
      const skew = Math.abs(rows[2].createdAt.getTime() - Date.now());
      expect(skew).toBeLessThan(60_000);
    });
  });

  describe('ghi chú không bao giờ lọt ra route khác', () => {
    it('chủ shop / chủ tài khoản / khách / chính màn quản trị khác (chi tiết người dùng, danh sách người dùng và shop) KHÔNG thấy nội dung ghi chú', async () => {
      const canary = `CANARY-NOTE-${randomUUID()}`;
      const ownerEmail = `${TAG}${stamp}owner@test.local`;
      const owner = newAgent();
      await owner
        .post('/api/v1/auth/register')
        .send({ email: ownerEmail, password: PASSWORD, name: `${TAG}owner` })
        .expect(201);
      await loginAs(owner, ownerEmail);
      const ownerId = (
        await prisma.user.findUniqueOrThrow({
          where: { email: ownerEmail },
          select: { id: true },
        })
      ).id;
      const shop = await prisma.shop.create({
        data: {
          ownerId,
          name: `${TAG}leak-shop`,
          slug: `${TAG}leak-shop-${stamp.toString(36)}`,
          status: 'APPROVED',
        },
        select: { id: true, slug: true },
      });

      for (const [targetType, targetId] of [
        ['SHOP', shop.id],
        ['USER', ownerId],
      ]) {
        const res = await add(admin, {
          targetType,
          targetId,
          content: `${canary} ${targetType}`,
        });
        expect(res.status).toBe(201);
      }

      // Đối chứng dương: đường DUY NHẤT thấy ghi chú là /admin/notes.
      for (const [targetType, targetId] of [
        ['SHOP', shop.id],
        ['USER', ownerId],
      ]) {
        const own = await list(admin, { targetType, targetId });
        expect(JSON.stringify(own.body)).toContain(canary);
      }

      const responses = {
        'GET /shops/me (chủ shop)': await owner.get('/api/v1/shops/me'),
        'GET /auth/me (chủ tài khoản)': await owner.get('/api/v1/auth/me'),
        'GET /shops/:slug (khách)': await anonymous.get(
          `/api/v1/shops/${shop.slug}`,
        ),
        'GET /admin/users/:id': await admin.get(
          `/api/v1/admin/users/${ownerId}`,
        ),
        'GET /admin/users?q=': await admin.get('/api/v1/admin/users').query({
          q: ownerEmail,
        }),
        'GET /admin/shops': await admin
          .get('/api/v1/admin/shops')
          .query({ status: 'APPROVED', limit: 50 }),
        'GET /admin/overview': await admin.get('/api/v1/admin/overview'),
      };

      for (const [name, res] of Object.entries(responses)) {
        expect([name, res.status]).toEqual([name, 200]);
        expect([name, JSON.stringify(res.body).includes(canary)]).toEqual([
          name,
          false,
        ]);
      }
      // Phòng quét rỗng: response của chủ shop và của khách thật sự có dữ liệu của chính shop.
      expect(
        JSON.stringify(responses['GET /shops/me (chủ shop)'].body),
      ).toContain(shop.slug);
      expect(
        JSON.stringify(responses['GET /shops/:slug (khách)'].body),
      ).toContain(shop.slug);
    });
  });

  describe('log không bao giờ chứa nội dung ghi chú', () => {
    it('quét MỌI đường ghi log (Logger + stdout/stderr) trong cả luồng thường lẫn khi ghi lỗi', async () => {
      const canary = `CANARY-${randomUUID()}`;
      const userId = await newUserId();
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
      const write = (content: string) =>
        admin.post(URL).send({ targetType: 'USER', targetId: userId, content });

      let leaky: request.Response;
      let down: request.Response;
      try {
        // 1. luồng thường
        await write(`${canary} ghi chú thường`);
        await list(admin, { targetType: 'USER', targetId: userId });
        // 2. sai dữ liệu: nội dung quá dài chứa canary
        await write(
          `${canary}${'x'.repeat(ADMIN_NOTE_CONTENT_MAX_LENGTH + 1)}`,
        );
        // 3. lỗi kiểm tra tham số của Prisma mang NGUYÊN giá trị đã ghi (kể cả nội dung ghi chú)
        jest
          .spyOn(prismaService.adminNote, 'create')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientValidationError(
              `Invalid invocation: data: { content: "${canary}" }`,
              { clientVersion: 'test' },
            ),
          );
        leaky = await write(`${canary} lỗi Prisma`);
        // 4. lỗi hạ tầng bất kỳ
        jest
          .spyOn(prismaService.adminNote, 'create')
          .mockRejectedValueOnce(new Error('db down'));
        down = await write(`${canary} DB sập`);
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
      // ...nhưng không có nội dung ghi chú.
      expect(logs).not.toContain(canary);
    });
  });

  describe('tài liệu API', () => {
    it('Swagger khớp hành vi thật: GET khai báo đúng 200, POST khai báo đúng 201, và mọi status đã quan sát được đều được khai báo', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('admin').setVersion('0').build(),
      );
      const path = document.paths['/api/v1/admin/notes'] as
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
        expect([...observed[method]].filter((s) => s !== 500).sort()).toEqual([
          success,
          400,
          401,
          403,
          404,
        ]);
      }
    });
  });
});
