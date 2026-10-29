import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import { REALTIME_EVENTS } from '@ecommerce/types';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/shared/interceptors/transform-response.interceptor';
import { MAIL_PROVIDER } from '../src/shared/mail/mail-provider.interface';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../src/shared/realtime/realtime-emitter';
import { RealtimeIoAdapter } from '../src/shared/realtime/realtime-io.adapter';
import { cleanupByTag } from '../src/shared/testing/db-fixtures';
import { createFakeMail } from '../src/shared/testing/fake-mail';

// e2e THẬT cho hiệu lực tức thì của việc Admin khoá tài khoản lên KẾT NỐI REAL-TIME (Week11.md 3.3): app Nest thật nghe
// trên cổng ngẫu nhiên + Postgres thật + `socket.io-client` thật qua WebSocket thật (cookie `access_token` và `Origin` trong
// handshake, đúng đường trình duyệt đi). Admin khoá qua HTTP thật; điều được chứng minh là mọi socket đang mở của người bị
// khoá bị ngắt NGAY SAU KHI DB đã đổi, họ KHÔNG nối lại được dù access token còn hạn, người khác không bị ảnh hưởng, và một
// yêu cầu bị từ chối (409) không ngắt ai. Phần HTTP / DB của cùng chức năng nằm ở admin-user-status.controller.int-spec.ts.
//
// QUY TẮC CHỐNG CHẬP CHỜN (như realtime.e2e-spec.ts): không `sleep`; mọi chờ đợi là chờ MỘT SỰ KIỆN và listener luôn được
// đăng ký TRƯỚC hành động gây ra nó. "KHÔNG nhận" khẳng định bằng sentinel gửi sau trên cùng kết nối.
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy). Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll.
const TAG = 'e2e-ususpend-';
const SECRET = 'e2e-ususpend-access-secret';
const APP_ORIGIN = 'https://app.e2e-ususpend.test';
const REASON = 'Vi phạm điều khoản sử dụng';

jest.setTimeout(15_000);

describe('Khoá tài khoản ngắt socket (e2e thật: Nest + Postgres + socket.io-client)', () => {
  const prisma = new PrismaClient();
  const jwt = new JwtService();
  const fakeMail = createFakeMail();
  const savedEnv = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  let app: INestApplication<Server>;
  let emitter: RealtimeEmitter;
  let url: string;
  let counter = 0;
  const sockets: Socket[] = [];

  const makeUser = (role: Role = Role.USER) =>
    prisma.user.create({
      data: {
        email: `${TAG}${Date.now().toString(36)}-${counter++}@test.local`,
        name: `${TAG}user`,
        role,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, role: true },
    });
  type TestUser = Awaited<ReturnType<typeof makeUser>>;

  const cookieOf = async (user: TestUser) =>
    `access_token=${await jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      { secret: SECRET, algorithm: 'HS256' },
    )}`;

  // Gọi API của Admin bằng cookie phiên (đi qua JwtStrategy + RolesGuard thật).
  async function adminPost(
    adminCookie: string,
    path: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/users/${path}`)
      .set('Cookie', adminCookie)
      .send(body);
  }

  function connect(cookie: string): Socket {
    const socket = io(url, {
      transports: ['websocket'],
      extraHeaders: { Origin: APP_ORIGIN, Cookie: cookie },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }
  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => reject(error));
    });
  const rejected = (socket: Socket) =>
    new Promise<string>((resolve, reject) => {
      socket.once('connect_error', (error) => resolve(error.message));
      socket.once('connect', () => reject(new Error('đã kết nối được')));
    });
  const disconnected = (socket: Socket) =>
    new Promise<string>((resolve) => {
      socket.once('disconnect', (reason) => resolve(reason));
    });
  const nextEvent = <T = unknown>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
    });
  const open = async (user: TestUser) => {
    const socket = connect(await cookieOf(user));
    await connected(socket);
    return socket;
  };
  // `socket` còn sống và không nhận gói lạ: phát một sentinel tới đúng người đó rồi chờ nó tới.
  async function expectOnlySentinel(socket: Socket, user: TestUser) {
    const received: string[] = [];
    socket.onAny((event: string) => received.push(event));
    const sentinel = nextEvent(socket, REALTIME_EVENTS.notificationNew);
    await emitter.emitToUser(user.id, REALTIME_EVENTS.notificationNew, {});
    await sentinel;
    socket.offAny();
    expect(received).toEqual([REALTIME_EVENTS.notificationNew]);
  }

  let admin: TestUser;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.CORS_ORIGIN = APP_ORIGIN;
    delete process.env.TRUST_PROXY;
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
    app.useWebSocketAdapter(new RealtimeIoAdapter(app));
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    emitter = app.get<RealtimeEmitter>(REALTIME_EMITTER);

    admin = await makeUser(Role.ADMIN);
    adminCookie = await cookieOf(admin);
  });

  beforeEach(() => {
    fakeMail.reset();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
    await cleanupByTag(prisma, TAG);
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each(['SUSPENDED', 'BANNED'] as const)(
    '%s: MỌI tab đang mở của người bị khoá bị ngắt (io server disconnect), người khác không bị ảnh hưởng',
    async (status) => {
      const [victim, bystander] = [await makeUser(), await makeUser()];
      const tabs = [await open(victim), await open(victim), await open(victim)];
      const bystanderSocket = await open(bystander);
      const closed = tabs.map((tab) => disconnected(tab));

      const res = await adminPost(adminCookie, `${victim.id}/suspend`, {
        status,
        reason: REASON,
      });

      expect(res.status).toBe(200);
      expect(await Promise.all(closed)).toEqual([
        'io server disconnect',
        'io server disconnect',
        'io server disconnect',
      ]);
      await expectOnlySentinel(bystanderSocket, bystander);
    },
  );

  it('socket chỉ bị ngắt SAU KHI DB đã đổi và nhật ký đã ghi (lúc nhận disconnect, đọc DB đã thấy SUSPENDED)', async () => {
    const victim = await makeUser();
    const socket = await open(victim);
    const stateAtDisconnect = new Promise<{
      status: AccountStatus;
      auditRows: number;
    }>((resolve) => {
      socket.once('disconnect', () => {
        void (async () => {
          const row = await prisma.user.findUniqueOrThrow({
            where: { id: victim.id },
            select: { accountStatus: true },
          });
          const auditRows = await prisma.adminAuditLog.count({
            where: { targetType: 'USER', targetId: victim.id },
          });
          resolve({ status: row.accountStatus, auditRows });
        })();
      });
    });

    await adminPost(adminCookie, `${victim.id}/suspend`, {
      status: 'SUSPENDED',
      reason: REASON,
    });

    expect(await stateAtDisconnect).toEqual({
      status: AccountStatus.SUSPENDED,
      auditRows: 1,
    });
  });

  it('người bị khoá KHÔNG nối lại được dù access token còn hạn (ACCOUNT_NOT_ACTIVE); mở lại thì nối lại được ngay', async () => {
    const victim = await makeUser();
    const cookie = await cookieOf(victim); // một token duy nhất, còn hạn ~15 phút, dùng cho cả ba lần nối
    const first = connect(cookie);
    await connected(first);
    const closed = disconnected(first);

    await adminPost(adminCookie, `${victim.id}/suspend`, {
      status: 'SUSPENDED',
      reason: REASON,
    });
    await closed;

    // Nối lại bằng ĐÚNG token cũ: handshake đọc lại accountStatus từ DB nên bị từ chối.
    await expect(rejected(connect(cookie))).resolves.toBe('ACCOUNT_NOT_ACTIVE');

    const reactivated = await adminPost(
      adminCookie,
      `${victim.id}/reactivate`,
      {
        reason: 'Khiếu nại được chấp nhận',
      },
    );
    expect(reactivated.status).toBe(200);

    const again = connect(cookie);
    await connected(again);
    await expectOnlySentinel(again, victim);
  });

  it('nâng từ tạm khoá lên cấm không làm gì lạ với socket: người bị khoá vẫn không nối lại được', async () => {
    const victim = await makeUser();
    const cookie = await cookieOf(victim);
    await adminPost(adminCookie, `${victim.id}/suspend`, {
      status: 'SUSPENDED',
      reason: REASON,
    });
    await expect(rejected(connect(cookie))).resolves.toBe('ACCOUNT_NOT_ACTIVE');

    const escalated = await adminPost(adminCookie, `${victim.id}/suspend`, {
      status: 'BANNED',
      reason: 'Nâng lên cấm',
    });

    expect(escalated.status).toBe(200);
    await expect(rejected(connect(cookie))).resolves.toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('yêu cầu bị từ chối (409) KHÔNG ngắt ai: khoá một Admin khác thất bại và socket của Admin đó còn nguyên', async () => {
    const otherAdmin = await makeUser(Role.ADMIN);
    const socket = await open(otherAdmin);

    const res = await adminPost(adminCookie, `${otherAdmin.id}/suspend`, {
      status: 'SUSPENDED',
      reason: REASON,
    });

    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe('CANNOT_MODIFY_ADMIN');
    await expectOnlySentinel(socket, otherAdmin);
  });

  it('user thường gọi API khoá ⇒ 403 và socket của nạn nhân còn nguyên', async () => {
    const [attacker, victim] = [await makeUser(), await makeUser()];
    const victimSocket = await open(victim);

    const res = await adminPost(
      await cookieOf(attacker),
      `${victim.id}/suspend`,
      { status: 'SUSPENDED', reason: REASON },
    );

    expect(res.status).toBe(403);
    await expectOnlySentinel(victimSocket, victim);
  });
});
