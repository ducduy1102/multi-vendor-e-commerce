import { IoAdapter } from '@nestjs/platform-socket.io';
import type { IncomingMessage } from 'http';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeIoAdapter } from './realtime-io.adapter';

const APP = 'https://app.example.com';

type AllowRequest = (
  request: IncomingMessage,
  callback: (error: string | null | undefined, success: boolean) => void,
) => void;

describe('RealtimeIoAdapter', () => {
  const originalCors = process.env.CORS_ORIGIN;
  let baseCreate: jest.SpyInstance;
  let adapter: RealtimeIoAdapter;

  beforeEach(() => {
    process.env.CORS_ORIGIN = APP;
    baseCreate = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue('io-server');
    const access = new RealtimeAccessService();
    adapter = new RealtimeIoAdapter({
      get: () => access,
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCors;
  });

  const createdAllowRequest = (): AllowRequest => {
    adapter.createIOServer(3000, { transports: ['websocket'] });
    const options = (baseCreate.mock.calls as unknown[][])[0][1] as {
      allowRequest: AllowRequest;
    };
    return options.allowRequest;
  };

  const upgradeRequest = (origin?: string) =>
    ({
      headers: origin === undefined ? {} : { origin },
      socket: { remoteAddress: '203.0.113.7' },
    }) as unknown as IncomingMessage;

  it('trả về chính server do IoAdapter gốc tạo và giữ nguyên các tuỳ chọn của gateway', () => {
    const server = adapter.createIOServer(3000, {
      transports: ['websocket'],
      maxHttpBufferSize: 1024,
    });

    expect(server).toBe('io-server');
    expect(baseCreate).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({
        transports: ['websocket'],
        maxHttpBufferSize: 1024,
        allowRequest: expect.any(Function) as AllowRequest,
      }),
    );
  });

  it('không có tuỳ chọn nào từ gateway vẫn gắn allowRequest', () => {
    adapter.createIOServer(3000);

    expect(baseCreate).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({
        allowRequest: expect.any(Function) as AllowRequest,
      }),
    );
  });

  describe('allowRequest (HTTP upgrade)', () => {
    it('Origin hợp lệ ⇒ cho nâng cấp lên WebSocket', () => {
      const callback = jest.fn();

      createdAllowRequest()(upgradeRequest(APP), callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('Origin lạ ⇒ từ chối kèm lý do', () => {
      const callback = jest.fn();

      createdAllowRequest()(upgradeRequest('https://evil.example'), callback);

      expect(callback).toHaveBeenCalledWith('FORBIDDEN_ORIGIN', false);
    });

    it('thiếu Origin ⇒ từ chối', () => {
      const callback = jest.fn();

      createdAllowRequest()(upgradeRequest(), callback);

      expect(callback).toHaveBeenCalledWith('FORBIDDEN_ORIGIN', false);
    });
  });
});
