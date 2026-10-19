import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket } from './test-socket';

const io = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io }));

import { defaultSocketFactory } from './socket-factory';

describe('defaultSocketFactory', () => {
  beforeEach(() => {
    io.mockReset();
  });

  it('nạp thư viện lúc được gọi và tạo socket với đúng URL + tuỳ chọn, không tự kết nối', async () => {
    const socket = new FakeSocket();
    io.mockReturnValue(socket);
    const options = {
      transports: ['websocket'] as ['websocket'],
      withCredentials: true as const,
      reconnection: false as const,
      autoConnect: false as const,
      timeout: 10_000,
    };

    const created = await defaultSocketFactory('http://api.test', options);

    expect(created).toBe(socket);
    expect(io).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith('http://api.test', options);
  });

  it('chưa gọi thì chưa nạp/dùng thư viện: định nghĩa factory không tạo socket', () => {
    expect(io).not.toHaveBeenCalled();
  });
});
