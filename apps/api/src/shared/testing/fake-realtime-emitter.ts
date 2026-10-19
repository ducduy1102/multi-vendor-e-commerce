import type { RealtimeEventName } from '@ecommerce/types';
import type { RealtimeEmitter } from '../realtime/realtime-emitter';

// RealtimeEmitter GIẢ cho unit/integration test: ghi lại mọi sự kiện "đã phát" và mọi lần ngắt kết nối để
// assert, và có thể bật chế độ lỗi để chứng minh lỗi đẩy không làm hỏng hành động nghiệp vụ. Cùng mẫu với
// fake-mail.ts.
export interface EmittedEvent {
  userId: string;
  event: RealtimeEventName;
  payload: unknown;
}

export interface FakeRealtimeEmitter extends RealtimeEmitter {
  emitted: EmittedEvent[];
  // userId của từng lần gọi disconnectUser, theo thứ tự.
  disconnected: string[];
  // Từ giờ mọi lần gọi đều reject (mô phỏng một bản cài đặt vi phạm hợp đồng "không bao giờ reject").
  failWith(error?: Error): void;
  reset(): void;
}

export function createFakeRealtimeEmitter(): FakeRealtimeEmitter {
  const emitted: EmittedEvent[] = [];
  const disconnected: string[] = [];
  let failure: Error | null = null;

  return {
    emitted,
    disconnected,
    emitToUser(userId, event, payload) {
      if (failure) return Promise.reject(failure);
      emitted.push({ userId, event, payload });
      return Promise.resolve();
    },
    disconnectUser(userId) {
      if (failure) return Promise.reject(failure);
      disconnected.push(userId);
      return Promise.resolve();
    },
    failWith(error = new Error('realtime down')) {
      failure = error;
    },
    reset() {
      emitted.length = 0;
      disconnected.length = 0;
      failure = null;
    },
  };
}
