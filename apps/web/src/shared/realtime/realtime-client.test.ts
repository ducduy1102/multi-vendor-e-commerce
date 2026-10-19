import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import {
  computeReconnectDelay,
  createRealtimeClient,
  CONNECT_TIMEOUT_MS,
  RECONNECT_MAX_DELAY_MS,
  STABLE_CONNECTION_MS,
  type RealtimeClient,
  type SocketFactory,
} from './realtime-client';
import { FakeSocket } from './test-socket';

const URL = 'http://api.test';

function setup(options: { visible?: boolean; sockets?: FakeSocket[] } = {}) {
  const sockets = options.sockets ?? [new FakeSocket()];
  let next = 0;
  const createSocket = vi.fn<SocketFactory>(() => {
    const socket = sockets[Math.min(next, sockets.length - 1)];
    next += 1;
    return Promise.resolve(socket);
  });
  const refreshSession = vi.fn<() => Promise<RefreshOutcome>>().mockResolvedValue('refreshed');
  let visible = options.visible ?? true;
  const visibilityListeners = new Set<() => void>();
  const client = createRealtimeClient({
    url: URL,
    createSocket,
    refreshSession,
    random: () => 1, // trần của backoff, để độ trễ dễ đọc: 2000, 4000, 8000...
    isVisible: () => visible,
    onVisible: (listener) => {
      visibilityListeners.add(listener);
      return () => {
        visibilityListeners.delete(listener);
      };
    },
  });
  return {
    client,
    sockets,
    socket: sockets[0],
    createSocket,
    refreshSession,
    setVisible(value: boolean) {
      visible = value;
      if (value) for (const listener of [...visibilityListeners]) listener();
    },
    watchingVisibility: () => visibilityListeners.size,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

// Dựng client đã nối thành công.
async function connected(options: Parameters<typeof setup>[0] = {}) {
  const harness = setup(options);
  harness.client.start();
  await flush();
  harness.socket.serverConnects();
  return harness;
}

describe('computeReconnectDelay', () => {
  it('tăng gấp đôi theo lần thử, kẹp ở trần', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((n) => computeReconnectDelay(n, () => 1));

    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it('jitter nằm trong [trần/2, trần]: lần đầu không bao giờ dưới 1 giây', () => {
    expect(computeReconnectDelay(0, () => 0)).toBe(1000);
    expect(computeReconnectDelay(0, () => 0.5)).toBe(1500);
    expect(computeReconnectDelay(0, () => 1)).toBe(2000);
    for (let attempt = 0; attempt < 12; attempt++) {
      for (const random of [0, 0.25, 0.9999, 1]) {
        const delay = computeReconnectDelay(attempt, () => random);
        const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, 2000 * 2 ** attempt);
        expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('lần thử rất lớn không tràn: vẫn hữu hạn và không quá trần', () => {
    expect(computeReconnectDelay(10_000, () => 1)).toBe(RECONNECT_MAX_DELAY_MS);
  });
});

describe('createRealtimeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('start / stop', () => {
    it('start: trạng thái connecting ngay, rồi tạo MỘT socket với đúng tuỳ chọn và kết nối', async () => {
      const { client, createSocket, socket } = setup();

      client.start();
      expect(client.getStatus()).toBe('connecting');
      await flush();

      expect(createSocket).toHaveBeenCalledTimes(1);
      expect(createSocket).toHaveBeenCalledWith(URL, {
        transports: ['websocket'],
        withCredentials: true,
        reconnection: false,
        autoConnect: false,
        timeout: CONNECT_TIMEOUT_MS,
      });
      expect(socket.connect).toHaveBeenCalledTimes(1);

      socket.serverConnects();
      expect(client.getStatus()).toBe('connected');
    });

    it('start lần hai khi đã chạy không tạo thêm socket', async () => {
      const { client, createSocket } = setup();

      client.start();
      client.start();
      await flush();

      expect(createSocket).toHaveBeenCalledTimes(1);
    });

    it('kiểu StrictMode (start → stop → start liền nhau) chỉ tạo đúng MỘT socket', async () => {
      const { client, createSocket, socket } = setup();

      client.start();
      client.stop();
      client.start();
      await flush();

      expect(createSocket).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(1);
    });

    it('stop: ngắt socket, về offline, và bỏ qua mọi sự kiện đến muộn từ socket cũ', async () => {
      const { client, socket } = await connected();

      client.stop();
      socket.serverConnects();
      socket.serverDisconnects('transport close');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('offline');
      expect(socket.connect).toHaveBeenCalledTimes(1); // không nối lại sau stop
    });

    it('stop trước khi socket kịp tạo (thư viện còn đang tải) ⇒ socket tới sau bị bỏ, không kết nối', async () => {
      const socket = new FakeSocket();
      let resolveSocket!: (value: FakeSocket) => void;
      const createSocket = vi.fn<SocketFactory>(
        () => new Promise<FakeSocket>((resolve) => (resolveSocket = resolve)),
      );
      const client = createRealtimeClient({
        url: URL,
        createSocket,
        refreshSession: vi.fn(),
      });

      client.start();
      await flush();
      client.stop();
      resolveSocket(socket);
      await flush();

      expect(socket.connect).not.toHaveBeenCalled();
      expect(client.getStatus()).toBe('offline');
    });

    it('stop rồi start lại dùng socket MỚI (đăng nhập người khác)', async () => {
      const first = new FakeSocket();
      const second = new FakeSocket();
      const { client, createSocket } = setup({ sockets: [first, second] });
      client.start();
      await flush();

      client.stop();
      client.start();
      await flush();

      expect(createSocket).toHaveBeenCalledTimes(2);
      expect(first.disconnect).toHaveBeenCalledTimes(1);
      expect(second.connect).toHaveBeenCalledTimes(1);
    });

    it('không nạp được thư viện (lỗi tải chunk) ⇒ thử lại theo backoff rồi tạo socket', async () => {
      const socket = new FakeSocket();
      const createSocket = vi
        .fn<SocketFactory>()
        .mockRejectedValueOnce(new Error('ChunkLoadError'))
        .mockResolvedValue(socket);
      const client = createRealtimeClient({
        url: URL,
        createSocket,
        refreshSession: vi.fn(),
        random: () => 1,
      });

      client.start();
      await flush();
      expect(client.getStatus()).toBe('connecting');
      expect(createSocket).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000);

      expect(createSocket).toHaveBeenCalledTimes(2);
      expect(socket.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('lỗi xác thực lúc kết nối', () => {
    it.each(['MISSING_TOKEN', 'INVALID_TOKEN'])(
      '%s ⇒ gia hạn phiên đúng MỘT lần rồi nối lại ngay (không chờ backoff)',
      async (reason) => {
        const { client, socket, refreshSession } = setup();
        client.start();
        await flush();

        socket.serverRejects(reason);
        await flush();

        expect(refreshSession).toHaveBeenCalledTimes(1);
        expect(socket.connect).toHaveBeenCalledTimes(2);
        expect(client.getStatus()).toBe('connecting');
      },
    );

    it('gia hạn xong mà vẫn bị từ chối xác thực ⇒ DỪNG, không gia hạn vòng vòng', async () => {
      const { client, socket, refreshSession } = setup();
      client.start();
      await flush();
      socket.serverRejects('INVALID_TOKEN');
      await flush();

      socket.serverRejects('INVALID_TOKEN');
      await vi.advanceTimersByTimeAsync(120_000);

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(client.getStatus()).toBe('offline');
    });

    it('nối được rồi thì lần lỗi xác thực SAU (vd token hết hạn tiếp) lại được gia hạn một lần nữa', async () => {
      const { client, socket, refreshSession } = setup();
      client.start();
      await flush();
      socket.serverRejects('INVALID_TOKEN');
      await flush();
      socket.serverConnects();

      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(2000);
      socket.serverRejects('INVALID_TOKEN');
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(2);
    });

    it('gia hạn trả skipped (tab khác vừa gia hạn) cũng nối lại', async () => {
      const { client, socket, refreshSession } = setup();
      refreshSession.mockResolvedValue('skipped');
      client.start();
      await flush();

      socket.serverRejects('INVALID_TOKEN');
      await flush();

      expect(socket.connect).toHaveBeenCalledTimes(2);
    });

    it('gia hạn bị TỪ CHỐI (phiên đã mất) ⇒ offline, không nối lại', async () => {
      const { client, socket, refreshSession } = setup();
      refreshSession.mockResolvedValue('rejected');
      client.start();
      await flush();

      socket.serverRejects('INVALID_TOKEN');
      await vi.advanceTimersByTimeAsync(120_000);

      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('offline');
    });

    it.each([
      [
        'trả unavailable (mất mạng, API đang thức)',
        () => Promise.resolve<RefreshOutcome>('unavailable'),
      ],
      ['ném lỗi', () => Promise.reject(new Error('boom'))],
    ])(
      'gia hạn %s ⇒ nối lại theo backoff và cho phép gia hạn lại ở lượt sau',
      async (_name, outcome) => {
        const { client, socket, refreshSession } = setup();
        refreshSession.mockImplementationOnce(outcome);
        client.start();
        await flush();

        socket.serverRejects('INVALID_TOKEN');
        await flush();
        expect(socket.connect).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2000);
        expect(socket.connect).toHaveBeenCalledTimes(2);

        socket.serverRejects('INVALID_TOKEN'); // lượt sau: được gia hạn lại vì lần trước chưa thật sự gia hạn
        await flush();
        expect(refreshSession).toHaveBeenCalledTimes(2);
      },
    );

    it('nhiều connect_error dồn dập khi đang gia hạn chỉ sinh MỘT lần gia hạn', async () => {
      const { client, socket, refreshSession } = setup();
      let finishRefresh!: (outcome: RefreshOutcome) => void;
      refreshSession.mockImplementation(
        () => new Promise<RefreshOutcome>((resolve) => (finishRefresh = resolve)),
      );
      client.start();
      await flush();

      socket.serverRejects('INVALID_TOKEN');
      socket.serverRejects('INVALID_TOKEN');
      socket.serverRejects('MISSING_TOKEN');
      await flush();
      finishRefresh('refreshed');
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(2);
    });

    it('kết quả gia hạn về SAU khi đã stop bị bỏ: không nối lại', async () => {
      const { client, socket, refreshSession } = setup();
      let finishRefresh!: (outcome: RefreshOutcome) => void;
      refreshSession.mockImplementation(
        () => new Promise<RefreshOutcome>((resolve) => (finishRefresh = resolve)),
      );
      client.start();
      await flush();
      socket.serverRejects('INVALID_TOKEN');
      await flush();

      client.stop();
      finishRefresh('refreshed');
      await flush();

      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('offline');
    });

    it('tab đang ẨN ⇒ không gia hạn; khi tab hiện lại mới gia hạn một lần rồi nối lại', async () => {
      const { client, socket, refreshSession, setVisible } = setup({ visible: false });
      client.start();
      await flush();

      socket.serverRejects('INVALID_TOKEN');
      await flush();
      expect(refreshSession).not.toHaveBeenCalled();
      expect(client.getStatus()).toBe('offline');

      setVisible(true);
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(2);
    });

    it.each(['ACCOUNT_NOT_ACTIVE', 'FORBIDDEN_ORIGIN'])(
      '%s ⇒ dừng hẳn: không gia hạn, không thử lại',
      async (reason) => {
        const { client, socket, refreshSession } = setup();
        client.start();
        await flush();

        socket.serverRejects(reason);
        await vi.advanceTimersByTimeAsync(300_000);

        expect(refreshSession).not.toHaveBeenCalled();
        expect(socket.connect).toHaveBeenCalledTimes(1);
        expect(client.getStatus()).toBe('offline');
      },
    );
  });

  describe('lỗi tạm thời ⇒ nối lại theo backoff', () => {
    it.each(['AUTH_UNAVAILABLE', 'TOO_MANY_ATTEMPTS', 'websocket error', 'timeout'])(
      '%s ⇒ chờ rồi thử lại, KHÔNG gia hạn phiên',
      async (reason) => {
        const { client, socket, refreshSession } = setup();
        client.start();
        await flush();

        socket.serverRejects(reason);
        expect(client.getStatus()).toBe('connecting');
        await vi.advanceTimersByTimeAsync(1999);
        expect(socket.connect).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        expect(socket.connect).toHaveBeenCalledTimes(2);
        expect(refreshSession).not.toHaveBeenCalled();
      },
    );

    it('độ trễ tăng dần 2s, 4s, 8s, 16s rồi kẹp ở 30s', async () => {
      const { client, socket } = setup();
      client.start();
      await flush();

      const waits: number[] = [];
      for (const expected of [2000, 4000, 8000, 16000, 30000, 30000]) {
        const before = socket.connect.mock.calls.length;
        socket.serverRejects('websocket error');
        await vi.advanceTimersByTimeAsync(expected - 1);
        expect(socket.connect.mock.calls.length).toBe(before); // chưa tới giờ
        await vi.advanceTimersByTimeAsync(1);
        expect(socket.connect.mock.calls.length).toBe(before + 1);
        waits.push(expected);
      }
      expect(waits).toHaveLength(6);
    });

    it('nối lại được thì hủy hẹn giờ còn treo và về connected', async () => {
      const { client, socket } = setup();
      client.start();
      await flush();
      socket.serverRejects('websocket error');
      await vi.advanceTimersByTimeAsync(2000);

      socket.serverConnects();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(client.getStatus()).toBe('connected');
      expect(socket.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('mất đường truyền sau khi đã nối', () => {
    it.each(['transport close', 'ping timeout', 'transport error'])(
      '%s ⇒ nối lại theo backoff, kể cả khi tab đang ẩn',
      async (reason) => {
        const { client, socket } = await connected({ visible: false });

        socket.serverDisconnects(reason);
        expect(client.getStatus()).toBe('connecting');
        await vi.advanceTimersByTimeAsync(2000);

        expect(socket.connect).toHaveBeenCalledTimes(2);
      },
    );

    it('disconnect do chính client gọi ("io client disconnect") không kích hoạt nối lại', async () => {
      const { client, socket } = await connected();

      socket.serverDisconnects('io client disconnect');
      await vi.advanceTimersByTimeAsync(120_000);

      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('offline');
    });

    it('bộ đếm lần thử CHỈ về 0 sau khi kết nối sống ổn định đủ lâu (chống vòng bị-đá/nối-lại ở nhịp nhanh nhất)', async () => {
      const { socket } = await connected();

      // Bị ngắt ngay sau khi nối: lần này chờ 2s, nối lại được nhưng lại bị ngắt ngay ⇒ lần sau chờ 4s.
      socket.serverDisconnects('transport close');
      await vi.advanceTimersByTimeAsync(2000);
      socket.serverConnects();
      await vi.advanceTimersByTimeAsync(1000);
      socket.serverDisconnects('transport close');
      await vi.advanceTimersByTimeAsync(3999);
      expect(socket.connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.connect).toHaveBeenCalledTimes(3);

      // Lần này sống ổn định đủ lâu ⇒ đếm lại từ đầu: bị ngắt thì chỉ chờ 2s.
      socket.serverConnects();
      await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS);
      socket.serverDisconnects('transport close');
      await vi.advanceTimersByTimeAsync(2000);

      expect(socket.connect).toHaveBeenCalledTimes(4);
    });
  });

  describe('server chủ động ngắt', () => {
    it('auth:expired rồi bị đóng ⇒ gia hạn phiên đúng MỘT lần rồi nối lại ngay', async () => {
      const { client, socket, refreshSession } = await connected();

      socket.serverEmits('auth:expired');
      socket.serverDisconnects('io server disconnect');
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(client.getStatus()).toBe('connecting');
    });

    it('hết hạn nhiều lần trong một phiên: mỗi lần nối được rồi thì lần sau lại gia hạn được', async () => {
      const { socket, refreshSession } = await connected();

      for (let round = 1; round <= 3; round++) {
        socket.serverEmits('auth:expired');
        socket.serverDisconnects('io server disconnect');
        await flush();
        socket.serverConnects();
        expect(refreshSession).toHaveBeenCalledTimes(round);
      }
    });

    it('auth:expired lúc tab đang ẨN ⇒ chưa gia hạn (để phiên hết đúng hạn nếu bị bỏ quên); hiện lại mới gia hạn', async () => {
      const { client, socket, refreshSession, setVisible } = await connected({ visible: false });

      socket.serverEmits('auth:expired');
      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(refreshSession).not.toHaveBeenCalled();
      expect(client.getStatus()).toBe('offline');

      setVisible(true);
      await flush();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(2);
    });

    it('bị ngắt thường (không auth:expired) ở tab HIỂN THỊ ⇒ nối lại theo backoff, KHÔNG gia hạn', async () => {
      const { socket, refreshSession } = await connected();

      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(1999);
      expect(socket.connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(refreshSession).not.toHaveBeenCalled();
    });

    it('bị ngắt thường ở tab ẨN ⇒ không nối lại (tránh các tab đá nhau); hiện lại mới nối', async () => {
      const { client, socket, setVisible } = await connected({ visible: false });

      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('offline');

      setVisible(true);
      await vi.advanceTimersByTimeAsync(2000);

      expect(socket.connect).toHaveBeenCalledTimes(2);
    });

    it('auth:expired của lượt trước không làm lần ngắt thường sau đó bị coi là hết hạn', async () => {
      const { socket, refreshSession } = await connected();
      socket.serverEmits('auth:expired');
      socket.serverDisconnects('io server disconnect');
      await flush();
      socket.serverConnects();

      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(2000);

      expect(refreshSession).toHaveBeenCalledTimes(1);
    });

    it('auth:expired tới nhưng kết nối đứt kiểu khác (transport close) ⇒ cờ không rò sang lần bị đá thường sau khi nối lại', async () => {
      const { socket, refreshSession } = await connected();
      socket.serverEmits('auth:expired');
      socket.serverDisconnects('transport close');
      await vi.advanceTimersByTimeAsync(2000);
      socket.serverConnects();

      socket.serverDisconnects('io server disconnect');
      await vi.advanceTimersByTimeAsync(4000);

      expect(refreshSession).not.toHaveBeenCalled();
    });

    it('stop khi đang chờ tab hiện lại ⇒ huỷ theo dõi, hiện lại cũng không nối', async () => {
      const { client, socket, setVisible, watchingVisibility } = await connected({
        visible: false,
      });
      socket.serverDisconnects('io server disconnect');
      expect(watchingVisibility()).toBe(1);

      client.stop();
      expect(watchingVisibility()).toBe(0);
      setVisible(true);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(socket.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('sự kiện server → client', () => {
    function collect(client: RealtimeClient, event: string) {
      const received: unknown[] = [];
      const unsubscribe = client.subscribeEvent(event, (payload) => received.push(payload));
      return { received, unsubscribe };
    }

    it('chuyển payload (tham số đầu tiên) tới đúng handler của đúng sự kiện', async () => {
      const { client, socket } = await connected();
      const read = collect(client, 'chat:read');
      const other = collect(client, 'notification:new');

      socket.serverEmits('chat:read', { n: 1 }, 'thừa');

      expect(read.received).toEqual([{ n: 1 }]);
      expect(other.received).toEqual([]);
    });

    it('nhiều handler cùng sự kiện đều nhận; huỷ đăng ký xong thì không nhận nữa', async () => {
      const { client, socket } = await connected();
      const a = collect(client, 'chat:read');
      const b = collect(client, 'chat:read');

      socket.serverEmits('chat:read', 1);
      a.unsubscribe();
      socket.serverEmits('chat:read', 2);

      expect(a.received).toEqual([1]);
      expect(b.received).toEqual([1, 2]);
    });

    it('sự kiện không có payload gửi undefined', async () => {
      const { client, socket } = await connected();
      const expired = collect(client, 'auth:expired');

      socket.serverEmits('auth:expired');

      expect(expired.received).toEqual([undefined]);
    });

    it('một handler ném lỗi không làm hỏng các handler khác hay kết nối', async () => {
      const { client, socket } = await connected();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      client.subscribeEvent('chat:read', () => {
        throw new Error('handler lỗi');
      });
      const good = collect(client, 'chat:read');

      expect(() => socket.serverEmits('chat:read', 'x')).not.toThrow();

      expect(good.received).toEqual(['x']);
      expect(error).toHaveBeenCalledTimes(1);
      expect(client.getStatus()).toBe('connected');
    });

    it('sự kiện không ai nghe bị bỏ qua, không lỗi', async () => {
      const { socket } = await connected();

      expect(() => socket.serverEmits('chat:message', { id: 1 })).not.toThrow();
    });

    it('đăng ký TRƯỚC khi có socket vẫn nhận được sau khi nối (hook mount trước provider khởi động)', async () => {
      const { client, socket } = setup();
      const read = collect(client, 'chat:read');
      client.start();
      await flush();
      socket.serverConnects();

      socket.serverEmits('chat:read', 'sớm');

      expect(read.received).toEqual(['sớm']);
    });

    it('sau stop không nhận gì từ socket cũ', async () => {
      const { client, socket } = await connected();
      const read = collect(client, 'chat:read');

      client.stop();
      socket.serverEmits('chat:read', 'muộn');

      expect(read.received).toEqual([]);
    });
  });

  describe('trạng thái', () => {
    it('chỉ báo khi trạng thái THAY ĐỔI, và ngừng báo sau khi huỷ đăng ký', async () => {
      const { client, socket } = setup();
      const listener = vi.fn();
      const unsubscribe = client.subscribeStatus(listener);

      client.start(); // offline → connecting
      await flush();
      socket.serverConnects(); // → connected
      socket.serverConnects(); // vẫn connected: không báo thêm
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      client.stop();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('ban đầu offline; stop luôn về offline', async () => {
      const { client } = setup();
      expect(client.getStatus()).toBe('offline');

      client.start();
      client.stop();

      expect(client.getStatus()).toBe('offline');
    });
  });
});
