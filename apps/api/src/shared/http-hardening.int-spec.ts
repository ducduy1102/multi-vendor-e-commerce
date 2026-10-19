import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { RejectFormBodyGuard } from './guards/reject-form-body.guard';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from './mail/mail-provider.interface';
import { cleanupByTag } from './testing/db-fixtures';
import { createFakeMail } from './testing/fake-mail';

// Integration test qua HTTP THẬT (supertest + Postgres thật) cho hai lớp bảo vệ dùng chung của tầng HTTP:
//  1. RejectFormBodyGuard (toàn cục): lệnh ghi mang body dạng form/multipart/text-plain ⇒ 415, không có tác dụng phụ
//     — chặn CSRF bằng form HTML từ trang khác (kể cả subdomain cùng site, nơi cookie SameSite=Lax vẫn được gửi);
//  2. AllExceptionsFilter: lỗi 4xx của body-parser (vd body quá lớn) ⇒ đúng status 4xx, không phải 500 và không log.
// Chạy: `pnpm test:int`.
const TAG = 'it-http-hardening-';
const API = '/api/v1';

describe('Bảo vệ tầng HTTP (HTTP thật)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const fakeMail = createFakeMail();
  const emailOf = (suffix: string) =>
    `${TAG}${stamp}${suffix}@test.local`.toLowerCase();

  // Đăng ký + đăng nhập bằng JSON (đường hợp lệ); trả agent đã có cookie.
  async function loggedIn(suffix: string) {
    const agent = request.agent(app.getHttpServer());
    const email = emailOf(suffix);
    await agent
      .post(`${API}/auth/register`)
      .send({ email, password: 'password123', name: `${TAG}${suffix}` })
      .expect(201);
    await agent
      .post(`${API}/auth/login`)
      .send({ email, password: 'password123' })
      .expect(200);
    return { agent, email };
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
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await cleanupByTag(prisma, TAG);
    await app.close();
    await prisma.$disconnect();
  });

  describe('lệnh ghi mang body dạng form ⇒ 415 và KHÔNG có tác dụng phụ', () => {
    it('POST /auth/register: form, multipart và text/plain đều bị từ chối, không tạo tài khoản', async () => {
      const server = request(app.getHttpServer());
      const fields = {
        email: emailOf('form-register'),
        password: 'password123',
        name: `${TAG}form`,
      };

      const urlencoded = await server
        .post(`${API}/auth/register`)
        .type('form')
        .send(fields);
      const multipart = await server
        .post(`${API}/auth/register`)
        .field('email', fields.email)
        .field('password', fields.password)
        .field('name', fields.name);
      const plain = await server
        .post(`${API}/auth/register`)
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify(fields));

      expect([urlencoded.status, multipart.status, plain.status]).toEqual([
        415, 415, 415,
      ]);
      expect(urlencoded.body).toEqual({
        success: false,
        data: null,
        message: 'Only application/json request bodies are accepted',
      });
      expect(await prisma.user.count({ where: { email: fields.email } })).toBe(
        0,
      );
    });

    it('POST /auth/login bằng form ⇒ 415 và không set cookie phiên (kể cả khi thông tin đăng nhập đúng)', async () => {
      const { email } = await loggedIn('form-login');

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .type('form')
        .send({ email, password: 'password123' });

      expect(res.status).toBe(415);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('PATCH /auth/me bằng form (có cookie phiên hợp lệ) ⇒ 415 và hồ sơ không đổi', async () => {
      const { agent, email } = await loggedIn('form-patch');

      const res = await agent
        .patch(`${API}/auth/me`)
        .type('form')
        .send({ name: 'bị đổi bởi form' });

      expect(res.status).toBe(415);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { name: true },
      });
      expect(user.name).toBe(`${TAG}form-patch`);
    });

    it('DELETE bằng form ⇒ 415 (guard chạy trước cả xác thực và id có thật hay không)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${API}/addresses/${randomUUID()}`)
        .type('form')
        .send({ x: 'y' });

      expect(res.status).toBe(415);
    });

    it('route của module khác (gửi tin chat) cũng được bảo vệ: form ⇒ 415, không ghi tin', async () => {
      const { agent } = await loggedIn('form-chat');

      const res = await agent
        .post(`${API}/conversations/${randomUUID()}/messages`)
        .type('form')
        .send({ content: 'từ form', clientMessageId: randomUUID() });

      expect(res.status).toBe(415);
      expect(
        await prisma.message.count({ where: { content: 'từ form' } }),
      ).toBe(0);
    });
  });

  describe('đường hợp lệ không bị ảnh hưởng', () => {
    it('JSON (có hoặc không có charset) vẫn đăng ký / đăng nhập bình thường', async () => {
      const email = emailOf('json-ok');
      const server = request(app.getHttpServer());

      const register = await server
        .post(`${API}/auth/register`)
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(
          JSON.stringify({
            email,
            password: 'password123',
            name: `${TAG}json`,
          }),
        );
      const login = await server
        .post(`${API}/auth/login`)
        .send({ email, password: 'password123' });

      expect(register.status).toBe(201);
      expect(login.status).toBe(200);
    });

    it('lệnh ghi KHÔNG có body (không có Content-Type) vẫn qua guard', async () => {
      const { agent } = await loggedIn('no-body');

      const res = await agent.post(`${API}/auth/logout`);

      expect(res.status).toBe(200);
    });

    it('GET mang Content-Type dạng form vẫn bình thường (không phải lệnh ghi)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/health`)
        .set('Content-Type', 'application/x-www-form-urlencoded');

      expect(res.status).toBe(200);
    });
  });

  describe('lỗi 4xx của body-parser trả đúng status, không thành 500 và không bị log như sự cố', () => {
    it('body JSON quá lớn ⇒ 413 đúng hình, không log lỗi', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const res = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: 'a@b.c', password: 'x'.repeat(300_000) });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({
        success: false,
        data: null,
        message: 'request entity too large',
      });
      expect(logged).not.toHaveBeenCalled();
    });

    it('body cực lớn (vài MB) cũng 413, server vẫn phục vụ tiếp', async () => {
      const big = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: 'a@b.c', password: 'x'.repeat(3_000_000) });
      const alive = await request(app.getHttpServer()).get(`${API}/health`);

      expect(big.status).toBe(413);
      expect(alive.status).toBe(200);
    });

    it('JSON hỏng vẫn là 400 (hành vi cũ giữ nguyên)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/auth/login`)
        .set('Content-Type', 'application/json')
        .send('{"email": ');

      expect(res.status).toBe(400);
    });

    it('lỗi hệ thống thật sự vẫn là 500 chung và vẫn được log', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      jest
        .spyOn(RejectFormBodyGuard.prototype, 'canActivate')
        .mockImplementation(() => {
          throw new Error('db exploded');
        });

      const res = await request(app.getHttpServer()).get(`${API}/health`);

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('db exploded');
      expect(logged).toHaveBeenCalled();
    });
  });
});
