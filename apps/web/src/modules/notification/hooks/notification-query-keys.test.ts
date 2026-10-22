import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_LIST_QUERY_KEY,
  NOTIFICATION_QUERY_KEY,
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, index) => key[index] === part);

describe('notification-query-keys', () => {
  it('mọi query thông báo nằm dưới MỘT tiền tố (làm mới tiền tố kéo theo danh sách và huy hiệu)', () => {
    expect(startsWith(notificationListQueryKey('all'), NOTIFICATION_QUERY_KEY)).toBe(true);
    expect(startsWith(notificationListQueryKey('unread'), NOTIFICATION_QUERY_KEY)).toBe(true);
    expect(startsWith(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, NOTIFICATION_QUERY_KEY)).toBe(true);
  });

  it('hai danh sách có chung tiền tố danh sách nhưng khác khoá', () => {
    expect(startsWith(notificationListQueryKey('all'), NOTIFICATION_LIST_QUERY_KEY)).toBe(true);
    expect(startsWith(notificationListQueryKey('unread'), NOTIFICATION_LIST_QUERY_KEY)).toBe(true);
    expect(notificationListQueryKey('all')).not.toEqual(notificationListQueryKey('unread'));
  });

  it('huy hiệu KHÔNG nằm dưới tiền tố danh sách (làm mới danh sách không động tới huy hiệu)', () => {
    expect(startsWith(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, NOTIFICATION_LIST_QUERY_KEY)).toBe(
      false,
    );
  });

  it('khoá không trùng khoá của module chat (tiền tố riêng)', () => {
    expect(NOTIFICATION_QUERY_KEY[0]).toBe('notification');
    expect(NOTIFICATION_QUERY_KEY[0]).not.toBe('chat');
  });
});
