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
import {
  REALTIME_FAILED_HANDSHAKE_MAX,
  REALTIME_MAX_SOCKETS_PER_USER,
} from '../src/shared/realtime/realtime.constants';
import { cleanupByTag } from '../src/shared/testing/db-fixtures';
import { createFakeMail } from '../src/shared/testing/fake-mail';

// e2e THẬT cho hạ tầng real-time (Week10.md 3.4): app Nest thật nghe trên cổng ngẫu nhiên + Postgres thật +
// `socket.io-client` thật kết nối qua WebSocket thật, đi qua đúng đường mà trình duyệt đi (cookie `access_token`
// và `Origin` trong handshake). Unit test của từng mảnh nằm ở src/shared/realtime/*.spec.ts; file này kiểm
// chúng ráp lại với nhau, kể cả việc đăng xuất qua HTTP thật ngắt socket.
//
// QUY TẮC CHỐNG CHẬP CHỜN: không `sleep` để chờ. Mọi chờ đợi là chờ MỘT SỰ KIỆN (promise bọc `once`), và
// listener luôn được đăng ký TRƯỚC hành động gây ra sự kiện. Muốn khẳng định "KHÔNG nhận" thì dùng sự kiện
// canh (sentinel) gửi sau trên CÙNG kết nối: các gói trên một kết nối đến theo đúng thứ tự server ghi, nên
// khi sentinel đã tới mà chưa thấy gói lạ nào thì gói lạ đó không bao giờ tới (nó đã phải đến trước).
//
// Cách chạy: `pnpm test:e2e` (cần Postgres đang chạy). Dữ liệu mang tiền tố TAG, dọn ở beforeAll/afterAll.
const TAG = 'e2e-realtime-';
const SECRET = 'e2e-realtime-access-secret';
const APP_ORIGIN = 'https://app.e2e-realtime.test';
const EVIL_ORIGIN = 'https://evil.example';

jest.setTimeout(10_000);

describe('Real-time (e2e thật: Nest + Postgres + socket.io-client)', () => {
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

  // --- dữ liệu và token --------------------------------------------------------------------------------
  const makeUser = (status: AccountStatus = AccountStatus.ACTIVE) =>
    prisma.user.create({
      data: {
        email: `${TAG}${Date.now().toString(36)}-${counter++}@test.local`,
        name: `${TAG}user`,
        role: Role.USER,
        accountStatus: status,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, role: true },
    });
  type TestUser = Awaited<ReturnType<typeof makeUser>>;

  const accessToken = (
    user: TestUser,
    options: { secret?: string; expiresAt?: number } = {},
  ) =>
    jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        exp: options.expiresAt ?? Math.floor(Date.now() / 1000) + 15 * 60,
      },
      { secret: options.secret ?? SECRET, algorithm: 'HS256' },
    );
  const cookieOf = async (user: TestUser) =>
    `access_token=${await accessToken(user)}`;

  // --- kết nối và chờ sự kiện --------------------------------------------------------------------------
  function connect(
    cookie?: string,
    options: {
      origin?: string | null;
      transports?: ('websocket' | 'polling')[];
      path?: string;
    } = {},
  ): Socket {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    const socket = io(url, {
      transports: options.transports ?? ['websocket'],
      extraHeaders: {
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(options.path ? { path: options.path } : {}),
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
  // Kết nối PHẢI bị từ chối; trả về `message` của connect_error.
  const rejected = (socket: Socket) =>
    new Promise<string>((resolve, reject) => {
      socket.once('connect_error', (error) => resolve(error.message));
      socket.once('connect', () => reject(new Error('đã kết nối được')));
    });
  const nextEvent = <T = unknown>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
    });
  const disconnected = (socket: Socket) =>
    new Promise<string>((resolve) => {
      socket.once('disconnect', (reason) => resolve(reason));
    });
  const open = async (user: TestUser) => {
    const socket = connect(await cookieOf(user));
    await connected(socket);
    return socket;
  };
  // Khẳng định `socket` còn sống và không nhận gói lạ: ghi lại mọi sự kiện, phát một sentinel tới đúng
  // người dùng đó rồi chờ nó tới.
  async function expectOnlySentinel(socket: Socket, user: TestUser) {
    const received: string[] = [];
    socket.onAny((event: string) => received.push(event));
    const sentinel = nextEvent(socket, REALTIME_EVENTS.notificationNew);
    await emitter.emitToUser(user.id, REALTIME_EVENTS.notificationNew, {});
    await sentinel;
    socket.offAny();
    expect(received).toEqual([REALTIME_EVENTS.notificationNew]);
  }

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
    // Giống main.ts: prefix REST, cookie-parser, interceptor/filter, adapter Socket.io tuỳ biến.
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useWebSocketAdapter(new RealtimeIoAdapter(app));
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    emitter = app.get<RealtimeEmitter>(REALTIME_EMITTER);
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

  // -------------------------------------------------------------------------------------------------------
  describe('kết nối hợp lệ và nhận sự kiện', () => {
    it('cookie hợp lệ ⇒ nhận sự kiện do emitToUser phát, người dùng KHÁC không nhận', async () => {
      const [a, b] = [await makeUser(), await makeUser()];
      const [socketA, socketB] = [await open(a), await open(b)];
      const payload = {
        conversationId: '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11',
        readAt: '2030-01-01T00:00:00.000Z',
      };

      const received = nextEvent(socketA, REALTIME_EVENTS.chatRead);
      await emitter.emitToUser(a.id, REALTIME_EVENTS.chatRead, payload);

      expect(await received).toEqual(payload);
      await expectOnlySentinel(socketB, b);
    });

    it('nhiều tab của cùng một người dùng ⇒ tất cả đều nhận', async () => {
      const user = await makeUser();
      const tabs = [await open(user), await open(user), await open(user)];
      const all = tabs.map((tab) => nextEvent(tab, REALTIME_EVENTS.chatRead));

      await emitter.emitToUser(user.id, REALTIME_EVENTS.chatRead, { n: 1 });

      expect(await Promise.all(all)).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    });

    it('sự kiện không có payload tới nơi mà không kèm tham số thừa', async () => {
      const user = await makeUser();
      const socket = await open(user);
      const args = new Promise<unknown[]>((resolve) => {
        socket.once(REALTIME_EVENTS.authExpired, (...rest: unknown[]) =>
          resolve(rest),
        );
      });

      await emitter.emitToUser(user.id, REALTIME_EVENTS.authExpired);

      expect(await args).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('từ chối kết nối', () => {
    it('thiếu cookie ⇒ connect_error MISSING_TOKEN', async () => {
      const socket = connect(undefined);

      await expect(rejected(socket)).resolves.toBe('MISSING_TOKEN');
    });

    it('token rác, ký sai secret, hoặc đã hết hạn ⇒ INVALID_TOKEN', async () => {
      const user = await makeUser();
      const garbage = connect('access_token=not.a.jwt');
      const wrongSecret = connect(
        `access_token=${await accessToken(user, { secret: 'another-secret' })}`,
      );
      const expired = connect(
        `access_token=${await accessToken(user, { expiresAt: Math.floor(Date.now() / 1000) - 30 })}`,
      );

      await expect(rejected(garbage)).resolves.toBe('INVALID_TOKEN');
      await expect(rejected(wrongSecret)).resolves.toBe('INVALID_TOKEN');
      await expect(rejected(expired)).resolves.toBe('INVALID_TOKEN');
    });

    it('chỉ có refresh_token (không có access_token) ⇒ MISSING_TOKEN', async () => {
      const user = await makeUser();
      const refreshOnly = `refresh_token=${await accessToken(user)}`;

      await expect(rejected(connect(refreshOnly))).resolves.toBe(
        'MISSING_TOKEN',
      );
    });

    it('Origin lạ, dù có cookie hợp lệ ⇒ bị từ chối (chống CSWSH)', async () => {
      const user = await makeUser();

      const socket = connect(await cookieOf(user), { origin: EVIL_ORIGIN });

      await expect(rejected(socket)).resolves.toEqual(expect.any(String));
      expect(socket.connected).toBe(false);
    });

    it('thiếu Origin, dù có cookie hợp lệ ⇒ bị từ chối', async () => {
      const user = await makeUser();

      const socket = connect(await cookieOf(user), { origin: null });

      await expect(rejected(socket)).resolves.toEqual(expect.any(String));
    });

    it('long-polling bị từ chối: chỉ nhận websocket', async () => {
      const user = await makeUser();

      const socket = connect(await cookieOf(user), {
        transports: ['polling'],
      });

      await expect(rejected(socket)).resolves.toEqual(expect.any(String));
    });

    it('/api/v1/socket.io không tồn tại: gateway nằm ngoài global prefix của REST', async () => {
      const user = await makeUser();

      const socket = connect(await cookieOf(user), {
        path: '/api/v1/socket.io',
      });

      await expect(rejected(socket)).resolves.toEqual(expect.any(String));
    });

    it('tài khoản bị khoá SAU KHI token được cấp ⇒ ACCOUNT_NOT_ACTIVE', async () => {
      const user = await makeUser();
      const cookie = await cookieOf(user); // token vẫn còn hạn
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: AccountStatus.SUSPENDED },
      });

      await expect(rejected(connect(cookie))).resolves.toBe(
        'ACCOUNT_NOT_ACTIVE',
      );
    });

    it('người dùng đã bị xoá ⇒ ACCOUNT_NOT_ACTIVE', async () => {
      const ghost = await makeUser();
      const cookie = await cookieOf(ghost);
      await prisma.user.delete({ where: { id: ghost.id } });

      await expect(rejected(connect(cookie))).resolves.toBe(
        'ACCOUNT_NOT_ACTIVE',
      );
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('ngắt kết nối', () => {
    it('access token hết hạn ⇒ nhận auth:expired rồi bị đóng', async () => {
      const user = await makeUser();
      const socket = connect(
        `access_token=${await accessToken(user, { expiresAt: Math.floor(Date.now() / 1000) + 2 })}`,
      );
      await connected(socket);
      const expired = nextEvent(socket, REALTIME_EVENTS.authExpired);
      const closed = disconnected(socket);

      await expired;

      // Socket.io coi đây là bị server ngắt ⇒ client KHÔNG tự nối lại; phải gia hạn phiên rồi connect().
      await expect(closed).resolves.toBe('io server disconnect');
    });

    it('mở quá 5 kết nối ⇒ kết nối CŨ NHẤT bị ngắt, 5 kết nối mới nhất còn nhận sự kiện', async () => {
      const user = await makeUser();
      const first = await open(user);
      const firstClosed = disconnected(first);
      const rest: Socket[] = [];
      for (let i = 1; i < REALTIME_MAX_SOCKETS_PER_USER + 1; i++) {
        rest.push(await open(user));
      }

      await expect(firstClosed).resolves.toBe('io server disconnect');
      const received = rest.map((tab) =>
        nextEvent(tab, REALTIME_EVENTS.chatRead),
      );
      await emitter.emitToUser(user.id, REALTIME_EVENTS.chatRead, { ok: 1 });
      expect(await Promise.all(received)).toHaveLength(
        REALTIME_MAX_SOCKETS_PER_USER,
      );
      expect(first.connected).toBe(false);
    });

    it('disconnectUser đóng mọi kết nối của đúng người dùng đó và không đụng người khác', async () => {
      const [a, b] = [await makeUser(), await makeUser()];
      const [a1, a2, socketB] = [await open(a), await open(a), await open(b)];
      const closed = [disconnected(a1), disconnected(a2)];

      await emitter.disconnectUser(a.id);

      await expect(Promise.all(closed)).resolves.toEqual([
        'io server disconnect',
        'io server disconnect',
      ]);
      await expectOnlySentinel(socketB, b);
    });

    it('POST /auth/logout qua HTTP thật ⇒ mọi tab của người đó bị ngắt, người khác không bị ảnh hưởng', async () => {
      const [a, b] = [await makeUser(), await makeUser()];
      const cookieA = await cookieOf(a);
      // `open` đăng ký listener `connect` ngay khi mở; không mở hai socket rồi mới chờ cái thứ ba — sự kiện
      // `connect` của hai socket đầu có thể đã bắn trước khi listener được đăng ký.
      const a1 = await open(a);
      const a2 = await open(a);
      const socketB = await open(b);
      const closed = [disconnected(a1), disconnected(a2)];

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieA)
        .expect(200);

      await expect(Promise.all(closed)).resolves.toEqual([
        'io server disconnect',
        'io server disconnect',
      ]);
      await expectOnlySentinel(socketB, b);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe('bề mặt tấn công', () => {
    it('client gửi sự kiện lạ (join/chat:message...) ⇒ bị bỏ qua, kết nối vẫn sống và không vào phòng của người khác', async () => {
      const [attacker, victim] = [await makeUser(), await makeUser()];
      const socket = await open(attacker);
      const received: string[] = [];
      socket.onAny((event: string) => received.push(event));

      socket.emit('join', `user:${victim.id}`);
      socket.emit('join-room', { room: `user:${victim.id}` });
      socket.emit(REALTIME_EVENTS.chatMessage, { content: 'x' });
      // Sự kiện của nạn nhân: kẻ tấn công không được nhận. Sentinel gửi tới chính kẻ tấn công tới SAU các gói
      // trên (cùng kết nối), nên nếu có gì lọt qua nó đã đến trước.
      await emitter.emitToUser(victim.id, REALTIME_EVENTS.chatRead, {
        secret: 'private',
      });
      const sentinel = nextEvent(socket, REALTIME_EVENTS.notificationNew);
      await emitter.emitToUser(
        attacker.id,
        REALTIME_EVENTS.notificationNew,
        {},
      );
      await sentinel;

      expect(received).toEqual([REALTIME_EVENTS.notificationNew]);
    });

    it('gói lớn hơn ~1 KB ⇒ server ngắt kết nối', async () => {
      const user = await makeUser();
      const socket = await open(user);
      const closed = disconnected(socket);

      socket.emit('big', 'x'.repeat(4096));

      await expect(closed).resolves.toEqual(expect.any(String));
      expect(socket.connected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  // PHẢI để cuối file: nó làm IP của máy test bị chặn trong phần đời còn lại của app này.
  describe('giới hạn handshake thất bại theo IP', () => {
    it('thất bại liên tục quá ngưỡng ⇒ IP bị chặn, kể cả khi sau đó có cookie đúng', async () => {
      const user = await makeUser();
      const goodCookie = await cookieOf(user);
      await connected(connect(goodCookie)); // trước khi bị chặn thì vào được

      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX + 5; i++) {
        await rejected(connect('access_token=bad'));
      }

      await expect(rejected(connect(goodCookie))).resolves.toEqual(
        expect.any(String),
      );
    });
  });
});
