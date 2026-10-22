import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  at,
  makeNotification,
  makeUnknownNotification,
  notificationsData,
  uuid,
} from '../notification-test-data';
import type { NotificationUnreadCount } from '../types';
import {
  adjustUnreadCount,
  markAllNotificationsReadInCache,
  markNotificationReadInCache,
  prependNotification,
  setUnreadCount,
  type NotificationsData,
} from './notification-cache';
import {
  NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
  notificationListQueryKey,
} from './notification-query-keys';

const ALL = notificationListQueryKey('all');
const UNREAD = notificationListQueryKey('unread');

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
});

const idsOf = (key: readonly unknown[]) =>
  queryClient
    .getQueryData<NotificationsData>(key)
    ?.pages.map((page) => page.items.map((item) => item.id));
const countOf = () =>
  queryClient.getQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY);

describe('prependNotification', () => {
  it('vào ĐẦU trang đầu của cả hai danh sách đã nạp (thông báo mới là chưa đọc)', () => {
    queryClient.setQueryData(ALL, notificationsData([makeNotification({ id: uuid(1) })]));
    queryClient.setQueryData(UNREAD, notificationsData([makeNotification({ id: uuid(1) })]));

    prependNotification(queryClient, makeNotification({ id: uuid(9), createdAt: at(10) }));

    expect(idsOf(ALL)).toEqual([[uuid(9), uuid(1)]]);
    expect(idsOf(UNREAD)).toEqual([[uuid(9), uuid(1)]]);
  });

  it('chỉ chèn vào trang ĐẦU, các trang sau nguyên vẹn', () => {
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(2) })], [makeNotification({ id: uuid(1) })]),
    );

    prependNotification(queryClient, makeNotification({ id: uuid(9) }));

    expect(idsOf(ALL)).toEqual([[uuid(9), uuid(2)], [uuid(1)]]);
  });

  it('IDEMPOTENT: đã có (theo id, ở bất kỳ trang nào) thì không chèn lại', () => {
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(2) })], [makeNotification({ id: uuid(1) })]),
    );

    prependNotification(queryClient, makeNotification({ id: uuid(1) }));
    prependNotification(queryClient, makeNotification({ id: uuid(2) }));

    expect(idsOf(ALL)).toEqual([[uuid(2)], [uuid(1)]]);
  });

  it('cùng một thông báo tới hai lần ⇒ vẫn một dòng', () => {
    queryClient.setQueryData(ALL, notificationsData([]));

    prependNotification(queryClient, makeNotification({ id: uuid(9) }));
    prependNotification(queryClient, makeNotification({ id: uuid(9) }));

    expect(idsOf(ALL)).toEqual([[uuid(9)]]);
  });

  it('danh sách "Chưa đọc" KHÔNG nhận thông báo đã đọc; "Tất cả" vẫn nhận', () => {
    queryClient.setQueryData(ALL, notificationsData([]));
    queryClient.setQueryData(UNREAD, notificationsData([]));

    prependNotification(queryClient, makeNotification({ id: uuid(9), readAt: at(5) }));

    expect(idsOf(ALL)).toEqual([[uuid(9)]]);
    expect(idsOf(UNREAD)).toEqual([[]]);
  });

  it('danh sách CHƯA nạp thì KHÔNG bị tạo ra (tránh "dữ liệu" giả một phần)', () => {
    prependNotification(queryClient, makeNotification({ id: uuid(9) }));

    expect(queryClient.getQueryData(ALL)).toBeUndefined();
    expect(queryClient.getQueryData(UNREAD)).toBeUndefined();
  });

  it('loại lạ (UNKNOWN) vẫn được chèn để hiện bằng nhãn chung', () => {
    queryClient.setQueryData(ALL, notificationsData([]));

    prependNotification(queryClient, makeUnknownNotification({ id: uuid(8) }));

    expect(idsOf(ALL)).toEqual([[uuid(8)]]);
  });

  it('không đụng dữ liệu cũ (bất biến): đối tượng dữ liệu mới, trang sau giữ nguyên tham chiếu', () => {
    const before = notificationsData(
      [makeNotification({ id: uuid(2) })],
      [makeNotification({ id: uuid(1) })],
    );
    queryClient.setQueryData(ALL, before);

    prependNotification(queryClient, makeNotification({ id: uuid(9) }));

    const after = queryClient.getQueryData<NotificationsData>(ALL);
    expect(after).not.toBe(before);
    expect(after?.pages[1]).toBe(before.pages[1]);
    expect(before.pages[0].items).toHaveLength(1);
  });
});

describe('markNotificationReadInCache', () => {
  const seed = () => {
    queryClient.setQueryData(
      ALL,
      notificationsData([
        makeNotification({ id: uuid(2) }),
        makeNotification({ id: uuid(1), readAt: at(1) }),
      ]),
    );
    queryClient.setQueryData(UNREAD, notificationsData([makeNotification({ id: uuid(2) })]));
  };

  it('"Tất cả": đặt readAt; "Chưa đọc": GỠ dòng đó; báo wasUnread', () => {
    seed();

    const result = markNotificationReadInCache(queryClient, uuid(2), at(50));

    expect(result).toEqual({ wasUnread: true });
    expect(
      queryClient.getQueryData<NotificationsData>(ALL)?.pages[0].items.find((n) => n.id === uuid(2))
        ?.readAt,
    ).toBe(at(50));
    expect(idsOf(UNREAD)).toEqual([[]]);
  });

  it('thông báo ĐÃ đọc từ trước ⇒ wasUnread=false và không đổi mốc đọc cũ', () => {
    seed();

    const result = markNotificationReadInCache(queryClient, uuid(1), at(50));

    expect(result).toEqual({ wasUnread: false });
    expect(
      queryClient.getQueryData<NotificationsData>(ALL)?.pages[0].items.find((n) => n.id === uuid(1))
        ?.readAt,
    ).toBe(at(1));
  });

  it('chỉ có trong "Chưa đọc" (danh sách "Tất cả" chưa nạp) vẫn nhận ra wasUnread', () => {
    queryClient.setQueryData(UNREAD, notificationsData([makeNotification({ id: uuid(2) })]));

    expect(markNotificationReadInCache(queryClient, uuid(2), at(50))).toEqual({ wasUnread: true });
  });

  it('không thấy ở danh sách nào (chưa nạp) ⇒ wasUnread=false, không tạo cache', () => {
    const result = markNotificationReadInCache(queryClient, uuid(2), at(50));

    expect(result).toEqual({ wasUnread: false });
    expect(queryClient.getQueryData(ALL)).toBeUndefined();
    expect(queryClient.getQueryData(UNREAD)).toBeUndefined();
  });

  it('id không có trong danh sách ⇒ không đổi gì', () => {
    seed();
    const before = queryClient.getQueryData<NotificationsData>(ALL);

    const result = markNotificationReadInCache(queryClient, uuid(99), at(50));

    expect(result).toEqual({ wasUnread: false });
    expect(queryClient.getQueryData(ALL)).toBe(before);
  });

  it('chỉ dòng đúng id đổi, dòng khác giữ nguyên', () => {
    queryClient.setQueryData(
      ALL,
      notificationsData([makeNotification({ id: uuid(3) }), makeNotification({ id: uuid(2) })]),
    );

    markNotificationReadInCache(queryClient, uuid(2), at(50));

    const items = queryClient.getQueryData<NotificationsData>(ALL)?.pages[0].items;
    expect(items?.find((n) => n.id === uuid(3))?.readAt).toBeNull();
    expect(items?.find((n) => n.id === uuid(2))?.readAt).toBe(at(50));
  });
});

describe('markAllNotificationsReadInCache', () => {
  it('"Tất cả": mọi dòng chưa đọc có readAt (dòng đã đọc giữ mốc cũ); "Chưa đọc" rỗng và hết con trỏ; huy hiệu về 0', () => {
    queryClient.setQueryData(
      ALL,
      notificationsData(
        [makeNotification({ id: uuid(3) }), makeNotification({ id: uuid(2), readAt: at(1) })],
        [makeNotification({ id: uuid(1) })],
      ),
    );
    queryClient.setQueryData(
      UNREAD,
      notificationsData([makeNotification({ id: uuid(3) })], [makeNotification({ id: uuid(1) })]),
    );
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 2,
    });

    markAllNotificationsReadInCache(queryClient, at(50));

    const all = queryClient.getQueryData<NotificationsData>(ALL);
    expect(all?.pages.flatMap((p) => p.items.map((n) => [n.id, n.readAt]))).toEqual([
      [uuid(3), at(50)],
      [uuid(2), at(1)],
      [uuid(1), at(50)],
    ]);
    expect(all?.pages[0].nextCursor).toBe('cursor-1'); // "Tất cả" vẫn còn trang sau
    const unread = queryClient.getQueryData<NotificationsData>(UNREAD);
    expect(unread?.pages).toEqual([{ items: [], nextCursor: null }]);
    expect(unread?.pageParams).toEqual([undefined]);
    expect(countOf()).toEqual({ unreadCount: 0 });
  });

  it('danh sách và huy hiệu CHƯA nạp thì không bị tạo ra', () => {
    markAllNotificationsReadInCache(queryClient, at(50));

    expect(queryClient.getQueryData(ALL)).toBeUndefined();
    expect(queryClient.getQueryData(UNREAD)).toBeUndefined();
    expect(countOf()).toBeUndefined();
  });
});

describe('adjustUnreadCount / setUnreadCount', () => {
  it('chỉnh tương đối khi huy hiệu đã nạp', () => {
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 5,
    });

    adjustUnreadCount(queryClient, -2);
    expect(countOf()).toEqual({ unreadCount: 3 });
    adjustUnreadCount(queryClient, +4);
    expect(countOf()).toEqual({ unreadCount: 7 });
  });

  it('không bao giờ xuống dưới 0', () => {
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 1,
    });

    adjustUnreadCount(queryClient, -5);

    expect(countOf()).toEqual({ unreadCount: 0 });
  });

  it('huy hiệu chưa nạp ⇒ không tạo ra', () => {
    adjustUnreadCount(queryClient, -1);
    setUnreadCount(queryClient, 3);

    expect(countOf()).toBeUndefined();
  });

  it('setUnreadCount đặt số mới, kẹp ở 0', () => {
    queryClient.setQueryData<NotificationUnreadCount>(NOTIFICATION_UNREAD_COUNT_QUERY_KEY, {
      unreadCount: 5,
    });

    setUnreadCount(queryClient, 2);
    expect(countOf()).toEqual({ unreadCount: 2 });
    setUnreadCount(queryClient, -3);
    expect(countOf()).toEqual({ unreadCount: 0 });
  });
});
