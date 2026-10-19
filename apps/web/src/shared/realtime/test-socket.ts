import { vi } from 'vitest';

import type { RealtimeClientSocket } from './realtime-client';

type Listener = (...args: never[]) => void;

// Socket giả cho test: ghi lại listener mà bộ điều khiển đăng ký và cho test "đóng vai server" bắn sự kiện vào.
// Chỉ dùng trong test (không import từ mã chạy thật).
export class FakeSocket implements RealtimeClientSocket {
  private listeners = new Map<string, Listener[]>();
  private anyListeners: ((event: string, ...args: unknown[]) => void)[] = [];
  connect = vi.fn();
  disconnect = vi.fn();

  on(event: 'connect', listener: () => void): this;
  on(event: 'connect_error', listener: (error: Error) => void): this;
  on(event: 'disconnect', listener: (reason: string) => void): this;
  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  onAny(listener: (event: string, ...args: unknown[]) => void): this {
    this.anyListeners.push(listener);
    return this;
  }

  serverConnects() {
    this.call('connect');
  }
  serverRejects(message: string) {
    this.call('connect_error', new Error(message));
  }
  serverDisconnects(reason: string) {
    this.call('disconnect', reason);
  }
  serverEmits(event: string, ...args: unknown[]) {
    for (const listener of this.anyListeners) listener(event, ...args);
  }

  private call(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}
