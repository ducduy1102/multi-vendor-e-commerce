import { REALTIME_EVENTS } from '@ecommerce/types';
import { createFakeRealtimeEmitter } from './fake-realtime-emitter';

describe('createFakeRealtimeEmitter', () => {
  it('ghi lại sự kiện đã phát và các lần ngắt kết nối theo thứ tự', async () => {
    const fake = createFakeRealtimeEmitter();

    await fake.emitToUser('u1', REALTIME_EVENTS.chatRead, { a: 1 });
    await fake.emitToUser('u2', REALTIME_EVENTS.authExpired);
    await fake.disconnectUser('u1');

    expect(fake.emitted).toEqual([
      { userId: 'u1', event: 'chat:read', payload: { a: 1 } },
      { userId: 'u2', event: 'auth:expired', payload: undefined },
    ]);
    expect(fake.disconnected).toEqual(['u1']);
  });

  it('failWith: mọi lần gọi sau đó reject và không ghi gì; reset đưa về trạng thái ban đầu', async () => {
    const fake = createFakeRealtimeEmitter();
    fake.failWith(new Error('down'));

    await expect(
      fake.emitToUser('u1', REALTIME_EVENTS.chatRead),
    ).rejects.toThrow('down');
    await expect(fake.disconnectUser('u1')).rejects.toThrow('down');
    expect(fake.emitted).toEqual([]);
    expect(fake.disconnected).toEqual([]);

    fake.reset();
    await expect(fake.disconnectUser('u1')).resolves.toBeUndefined();
    expect(fake.disconnected).toEqual(['u1']);
  });
});
