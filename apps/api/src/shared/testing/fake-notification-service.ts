import { Logger } from '@nestjs/common';
import type { NotificationEvent } from '../notification/notification-events';
import type { NotificationFactsLoader } from '../notification/notification-facts.loader';
import { NotificationService } from '../notification/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { createFakeRealtimeEmitter } from './fake-realtime-emitter';

// NotificationService GIẢ cho unit/integration test của các service nghiệp vụ (Week10.md 7.4): ghi lại mọi sự kiện đã
// được phát để assert "nơi gọi báo đúng sự kiện, đúng lúc" mà không cần DB hay socket. Cùng mẫu với fake-mail.ts và
// fake-realtime-emitter.ts. Kiểu trả về là NotificationService thật (class có thành viên private nên TypeScript so sánh
// theo tên) — ép kiểu một lần ở đây để nơi dùng không phải ép lại.
export interface FakeNotificationService extends NotificationService {
  // `notify` là jest.fn thật (khai là thuộc tính, không phải method) để test viết `expect(notifications.notify)` mà không
  // vướng quy tắc unbound-method, và đổi được hành vi bằng `.mockImplementation`.
  notify: jest.Mock<Promise<void>, [NotificationEvent]>;
  // Mọi sự kiện đã phát, theo thứ tự.
  events: NotificationEvent[];
  reset(): void;
}

export function createFakeNotificationService(): FakeNotificationService {
  const events: NotificationEvent[] = [];
  const fake = {
    events,
    notify: jest.fn((event: NotificationEvent): Promise<void> => {
      events.push(event);
      return Promise.resolve();
    }),
    reset(): void {
      events.length = 0;
    },
  };
  return fake as unknown as FakeNotificationService;
}

// NotificationService THẬT nhưng hạ tầng bên dưới hỏng (bộ tải dữ kiện luôn lỗi, như DB sập) — để chứng minh một lỗi ở
// tầng thông báo KHÔNG làm hỏng thao tác nghiệp vụ gọi nó (đúng hợp đồng: `notify` không bao giờ reject). Logger của
// service này in lỗi nên test dùng nó nên tắt log (`silenceNotificationLogs`).
export function createBrokenNotificationService(): NotificationService {
  const brokenLoader = {
    load: () =>
      Promise.reject(new Error('notification infrastructure is down')),
  };
  return new NotificationService(
    {} as unknown as PrismaService,
    brokenLoader as unknown as NotificationFactsLoader,
    createFakeRealtimeEmitter(),
  );
}

// Tắt log lỗi/cảnh báo của NotificationService trong một test (gọi trong beforeEach; khôi phục bằng
// jest.restoreAllMocks() ở afterEach). Trả hai spy để test khẳng định lỗi ĐÃ được log (không bị nuốt im lặng).
export function silenceNotificationLogs(): {
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
} {
  return {
    error: jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
  };
}
