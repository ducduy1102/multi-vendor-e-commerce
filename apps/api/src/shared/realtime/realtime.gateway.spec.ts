import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { REALTIME_EVENTS } from '@ecommerce/types';
import type { IncomingHttpHeaders } from 'http';
import { RealtimeAccessService } from './realtime-access.service';
import {
  REALTIME_CONNECT_TIMEOUT_MS,
  REALTIME_FAILED_HANDSHAKE_MAX,
  REALTIME_MAX_HTTP_BUFFER_BYTES,
  REALTIME_MAX_SOCKETS_PER_USER,
} from './realtime.constants';
import { RealtimeGateway } from './realtime.gateway';
import type {
  RealtimeMiddleware,
  RealtimeServer,
  RealtimeSocket,
  RealtimeSocketData,
  RealtimeSocketHandle,
} from './realtime.types';
import type { VerifiedSocketToken } from './socket-authenticator';

const APP = 'https://app.example.com';
const TOKEN = 'secret.access.token';
const USER: VerifiedSocketToken = {
  userId: 'user-1',
  role: Role.USER,
  exp: 2_000_000_000,
};

interface FakeHandle extends RealtimeSocketHandle {
  disconnect: jest.Mock;
}

interface FakeSocket extends RealtimeSocket {
  join: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

function fakeSocket(
  options: {
    id?: string;
    headers?: IncomingHttpHeaders;
    address?: string;
    data?: Partial<RealtimeSocketData>;
  } = {},
): FakeSocket {
  return {
    id: options.id ?? 'sock-1',
    handshake: {
      headers: options.headers ?? {},
      address: options.address ?? '203.0.113.7',
    },
    data: options.data ?? {},
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

// Một kết nối trình duyệt hợp lệ: Origin của app + cookie access_token.
const browserSocket = (overrides: Parameters<typeof fakeSocket>[0] = {}) =>
  fakeSocket({
    headers: { origin: APP, cookie: `access_token=${TOKEN}` },
    ...overrides,
  });

describe('RealtimeGateway', () => {
  const originalEnv = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  let access: RealtimeAccessService;
  let authenticator: { verifyToken: jest.Mock; isUserActive: jest.Mock };
  let fetchSockets: jest.Mock;
  let server: { use: jest.Mock; in: jest.Mock };
  let gateway: RealtimeGateway;
  let middleware: RealtimeMiddleware;
  let errorLog: jest.SpyInstance;

  // Chạy middleware kết nối như socket.io và trả về lỗi từ chối (hoặc undefined nếu cho qua).
  const admit = (socket: RealtimeSocket) =>
    new Promise<Error | undefined>((resolve) => middleware(socket, resolve));

  beforeEach(() => {
    process.env.CORS_ORIGIN = APP;
    delete process.env.TRUST_PROXY;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    access = new RealtimeAccessService();
    authenticator = {
      verifyToken: jest.fn().mockResolvedValue(USER),
      isUserActive: jest.fn().mockResolvedValue(true),
    };
    fetchSockets = jest.fn().mockResolvedValue([]);
    server = {
      use: jest.fn(),
      in: jest.fn().mockReturnValue({ fetchSockets }),
    };
    gateway = new RealtimeGateway(access, authenticator);
    // Nest gán `server` qua @WebSocketServer(); trong test gán thẳng.
    (gateway as unknown as { server: RealtimeServer }).server = server;
    gateway.afterInit(server);
    middleware = (server.use.mock.calls as RealtimeMiddleware[][])[0][0];
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe('bề mặt tấn công', () => {
    it('chỉ websocket, gói rất nhỏ, connectTimeout ngắn, không phục vụ file client', () => {
      const options = Reflect.getMetadata(
        'websockets:gateway_options',
        RealtimeGateway,
      ) as Record<string, unknown>;

      expect(options).toMatchObject({
        transports: ['websocket'],
        maxHttpBufferSize: REALTIME_MAX_HTTP_BUFFER_BYTES,
        connectTimeout: REALTIME_CONNECT_TIMEOUT_MS,
        serveClient: false,
      });
      expect(REALTIME_MAX_HTTP_BUFFER_BYTES).toBeLessThanOrEqual(1024);
      expect(REALTIME_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    });

    it('KHÔNG có @SubscribeMessage nào: client không có sự kiện nào để tự vào phòng hay ghi dữ liệu', () => {
      const prototype = RealtimeGateway.prototype as unknown as Record<
        string,
        unknown
      >;
      const handlers = Object.getOwnPropertyNames(prototype).filter(
        (name) =>
          typeof prototype[name] === 'function' &&
          Reflect.getMetadata('__isMessageMapping', prototype[name] as object),
      );

      expect(handlers).toEqual([]);
    });
  });

  describe('middleware kết nối', () => {
    it('Origin + cookie hợp lệ ⇒ cho qua và gắn người dùng vào socket.data', async () => {
      const socket = browserSocket();

      await expect(admit(socket)).resolves.toBeUndefined();

      expect(socket.data.user).toEqual(USER);
      expect(socket.data.connectedAt).toEqual(expect.any(Number));
      expect(authenticator.verifyToken).toHaveBeenCalledWith(TOKEN);
    });

    it('Origin lạ ⇒ FORBIDDEN_ORIGIN, không đụng tới cổng xác thực', async () => {
      const socket = browserSocket({
        headers: {
          origin: 'https://evil.example',
          cookie: `access_token=${TOKEN}`,
        },
      });

      const error = await admit(socket);

      expect(error?.message).toBe('FORBIDDEN_ORIGIN');
      expect(authenticator.verifyToken).not.toHaveBeenCalled();
      expect(socket.data.user).toBeUndefined();
    });

    it('thiếu Origin ⇒ FORBIDDEN_ORIGIN (kể cả có cookie hợp lệ)', async () => {
      const socket = fakeSocket({
        headers: { cookie: `access_token=${TOKEN}` },
      });

      expect((await admit(socket))?.message).toBe('FORBIDDEN_ORIGIN');
    });

    it('thiếu cookie ⇒ MISSING_TOKEN', async () => {
      const socket = fakeSocket({ headers: { origin: APP } });

      expect((await admit(socket))?.message).toBe('MISSING_TOKEN');
    });

    it('token sai hoặc hết hạn ⇒ INVALID_TOKEN', async () => {
      authenticator.verifyToken.mockResolvedValue(null);

      expect((await admit(browserSocket()))?.message).toBe('INVALID_TOKEN');
    });

    it('tài khoản bị khoá sau khi token được cấp ⇒ ACCOUNT_NOT_ACTIVE', async () => {
      authenticator.isUserActive.mockResolvedValue(false);

      const socket = browserSocket();

      expect((await admit(socket))?.message).toBe('ACCOUNT_NOT_ACTIVE');
      expect(socket.data.user).toBeUndefined();
    });

    it('lỗi hạ tầng (DB sập) ⇒ AUTH_UNAVAILABLE: đóng kết nối và KHÔNG đếm vào IP', async () => {
      authenticator.isUserActive.mockRejectedValue(new Error('db down'));

      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX + 5; i++) {
        expect((await admit(browserSocket()))?.message).toBe(
          'AUTH_UNAVAILABLE',
        );
      }
      // Hạ tầng phục hồi: IP đó vẫn vào được (chưa bị chặn oan vì lỗi của server).
      authenticator.isUserActive.mockResolvedValue(true);
      await expect(admit(browserSocket())).resolves.toBeUndefined();
    });

    it('lỗi hạ tầng chỉ log thông điệp lỗi, không bao giờ log cookie/token/header', async () => {
      authenticator.verifyToken.mockRejectedValue(new Error('db down'));

      await admit(browserSocket());

      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(logged).toContain('db down');
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain('access_token');
      expect(logged).not.toContain(APP);
    });

    it('thất bại xác thực lặp lại quá ngưỡng ⇒ IP bị chặn, kể cả khi sau đó có token đúng', async () => {
      authenticator.verifyToken.mockResolvedValue(null);
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX; i++) {
        expect((await admit(browserSocket()))?.message).toBe('INVALID_TOKEN');
      }

      authenticator.verifyToken.mockResolvedValue(USER);
      authenticator.verifyToken.mockClear();

      expect((await admit(browserSocket()))?.message).toBe('TOO_MANY_ATTEMPTS');
      expect(authenticator.verifyToken).not.toHaveBeenCalled();
    });

    it('IP khác không bị chặn lây', async () => {
      authenticator.verifyToken.mockResolvedValue(null);
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX; i++) {
        await admit(browserSocket());
      }
      authenticator.verifyToken.mockResolvedValue(USER);

      await expect(
        admit(browserSocket({ address: '198.51.100.9' })),
      ).resolves.toBeUndefined();
    });

    it('kết nối thành công không làm tăng bộ đếm thất bại', async () => {
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX * 2; i++) {
        await expect(admit(browserSocket())).resolves.toBeUndefined();
      }
    });
  });

  describe('handleConnection', () => {
    const connected = (id = 'sock-1', connectedAt = 1) =>
      browserSocket({ id, data: { user: USER, connectedAt } });

    it('vào đúng phòng riêng của người dùng, do SERVER gán từ userId đã xác thực', async () => {
      const client = connected();

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('socket chưa qua xác thực (không có socket.data.user) ⇒ bị đóng, không vào phòng nào', async () => {
      const client = fakeSocket();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('đúng trần số kết nối ⇒ không ngắt ai', async () => {
      const handles: FakeHandle[] = Array.from(
        { length: REALTIME_MAX_SOCKETS_PER_USER },
        (_, i) => ({
          id: `s${i}`,
          data: { connectedAt: i },
          disconnect: jest.fn(),
        }),
      );
      fetchSockets.mockResolvedValue(handles);

      await gateway.handleConnection(connected());

      for (const handle of handles) {
        expect(handle.disconnect).not.toHaveBeenCalled();
      }
      expect(server.in).toHaveBeenCalledWith('user:user-1');
    });

    it('vượt trần ⇒ ngắt các kết nối CŨ NHẤT (chỉ rời namespace: `disconnect(false)`), giữ các kết nối mới', async () => {
      // Cố ý xáo thứ tự để chứng minh việc sắp xếp theo thời điểm kết nối.
      const connectedAts = [50, 10, 70, 30, 20, 60, 40];
      const handles = connectedAts.map((connectedAt) => ({
        id: `s${connectedAt}`,
        data: { connectedAt },
        disconnect: jest.fn(),
      }));
      fetchSockets.mockResolvedValue(handles);

      await gateway.handleConnection(connected());

      const evicted = handles
        .filter((h) => h.disconnect.mock.calls.length > 0)
        .map((h) => h.data.connectedAt)
        .sort((a, b) => a - b);
      expect(evicted).toEqual([10, 20]); // 7 - 5 = 2 cái cũ nhất
      for (const handle of handles) {
        if (evicted.includes(handle.data.connectedAt)) {
          expect(handle.disconnect).toHaveBeenCalledWith(false);
        }
      }
    });

    it('lỗi khi dựng kết nối (vd adapter lỗi) ⇒ log id người dùng và đóng kết nối', async () => {
      fetchSockets.mockRejectedValue(new Error('adapter down'));
      const client = connected();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(logged).toContain('user-1');
      expect(logged).toContain('adapter down');
      expect(logged).not.toContain(TOKEN);
    });
  });

  describe('ngắt khi access token hết hạn', () => {
    const NOW = Date.UTC(2030, 0, 1);
    const connectedUntil = (expiresAtMs: number, id = 'sock-1') =>
      browserSocket({
        id,
        data: {
          user: { ...USER, exp: Math.floor(expiresAtMs / 1000) },
          connectedAt: 1,
        },
      });

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
    });

    it('tới đúng hạn: phát auth:expired rồi đóng kết nối; trước hạn thì chưa', async () => {
      const client = connectedUntil(NOW + 60_000);
      await gateway.handleConnection(client);

      jest.advanceTimersByTime(59_000);
      expect(client.emit).not.toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      expect(client.emit).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith(REALTIME_EVENTS.authExpired);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      // Thứ tự: gói tin báo hết hạn phải được gửi TRƯỚC khi đóng.
      expect(client.emit.mock.invocationCallOrder[0]).toBeLessThan(
        client.disconnect.mock.invocationCallOrder[0],
      );
    });

    it('token đã hết hạn lúc vào (lệch đồng hồ) ⇒ ngắt ngay', async () => {
      const client = connectedUntil(NOW - 5_000);
      await gateway.handleConnection(client);

      jest.advanceTimersByTime(0);

      expect(client.emit).toHaveBeenCalledWith(REALTIME_EVENTS.authExpired);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('client ngắt trước hạn ⇒ hẹn giờ bị huỷ, không phát gì lên socket đã đóng', async () => {
      const client = connectedUntil(NOW + 60_000);
      await gateway.handleConnection(client);

      gateway.handleDisconnect(client);
      jest.advanceTimersByTime(120_000);

      expect(client.emit).not.toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('mỗi socket có hẹn giờ riêng: huỷ một cái không ảnh hưởng cái khác', async () => {
      const a = connectedUntil(NOW + 60_000, 'a');
      const b = connectedUntil(NOW + 60_000, 'b');
      await gateway.handleConnection(a);
      await gateway.handleConnection(b);

      gateway.handleDisconnect(a);
      jest.advanceTimersByTime(60_000);

      expect(a.emit).not.toHaveBeenCalled();
      expect(b.emit).toHaveBeenCalledWith(REALTIME_EVENTS.authExpired);
    });

    it('hạn rất xa (vượt giới hạn setTimeout ~24,8 ngày) không bị ngắt sớm, và vẫn ngắt đúng hạn', async () => {
      const day = 24 * 60 * 60 * 1000;
      const client = connectedUntil(NOW + 40 * day);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      await gateway.handleConnection(client);

      // setTimeout nhận tối đa 2^31-1 ms; lớn hơn thì Node đổi thành 1ms và vòng hẹn giờ quay vô hạn. Khẳng định
      // thẳng độ trễ đã kẹp (fail ngay) thay vì chỉ trông chờ vào việc tua giờ không treo.
      const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay ?? 0);
      expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);

      jest.advanceTimersByTime(30 * day);
      expect(client.emit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(10 * day);
      expect(client.emit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('tắt module ⇒ mọi hẹn giờ bị huỷ', async () => {
      const client = connectedUntil(NOW + 60_000);
      await gateway.handleConnection(client);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(120_000);

      expect(client.emit).not.toHaveBeenCalled();
    });
  });
});
