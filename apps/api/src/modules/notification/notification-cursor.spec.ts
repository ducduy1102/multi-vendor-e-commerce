import { notificationCursorSchema } from '@ecommerce/types';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
} from './notification-cursor';

const ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const AT = new Date('2030-01-02T12:00:00.123Z');

describe('notification cursor', () => {
  it('mã hoá rồi giải mã trả đúng (createdAt, id)', () => {
    expect(
      decodeNotificationCursor(encodeNotificationCursor({ at: AT, id: ID })),
    ).toEqual({ at: AT, id: ID });
  });

  it('con trỏ sinh ra luôn qua notificationCursorSchema (schema mà controller dùng để lọc query)', () => {
    expect(
      notificationCursorSchema.safeParse(
        encodeNotificationCursor({ at: AT, id: ID }),
      ).success,
    ).toBe(true);
  });

  it.each([[''], ['not a cursor'], ['A'.repeat(121)], ['bm90LXZhbGlk']])(
    'từ chối con trỏ hỏng %j',
    (raw) => {
      expect(decodeNotificationCursor(raw)).toBeNull();
    },
  );
});
