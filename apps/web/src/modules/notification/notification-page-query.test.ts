import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_TAB,
  NOTIFICATION_TABS,
  NOTIFICATION_TAB_LABEL_KEYS,
  buildNotificationsHref,
  parseNotificationsPageQuery,
} from './notification-page-query';

describe('parseNotificationsPageQuery', () => {
  it('thiếu `tab` ⇒ tab mặc định "Tất cả"', () => {
    expect(parseNotificationsPageQuery({})).toEqual({ tab: 'all' });
  });

  it.each(NOTIFICATION_TABS)('`?tab=%s` hợp lệ được giữ nguyên', (tab) => {
    expect(parseNotificationsPageQuery({ tab })).toEqual({ tab });
  });

  it.each(['', 'UNREAD', 'read', 'all ', '../x', '<script>', 'constructor', '__proto__'])(
    '`?tab=%j` lạ/sai dạng ⇒ rơi về mặc định, không ném lỗi',
    (tab) => {
      expect(parseNotificationsPageQuery({ tab })).toEqual({ tab: DEFAULT_NOTIFICATION_TAB });
    },
  );

  it('lặp `?tab=a&tab=b` lấy giá trị ĐẦU', () => {
    expect(parseNotificationsPageQuery({ tab: ['unread', 'all'] })).toEqual({ tab: 'unread' });
    expect(parseNotificationsPageQuery({ tab: ['bad', 'unread'] })).toEqual({ tab: 'all' });
  });

  it('mảng rỗng ⇒ mặc định', () => {
    expect(parseNotificationsPageQuery({ tab: [] })).toEqual({ tab: 'all' });
  });
});

describe('buildNotificationsHref', () => {
  it('tab mặc định không mang tham số (URL gọn, trùng đường dẫn Header/menu trỏ tới)', () => {
    expect(buildNotificationsHref('all')).toEqual({ pathname: '/notifications', query: {} });
  });

  it('tab "Chưa đọc" mang `tab=unread`', () => {
    expect(buildNotificationsHref('unread')).toEqual({
      pathname: '/notifications',
      query: { tab: 'unread' },
    });
  });

  it('href dựng ra đọc ngược lại được đúng tab (round-trip)', () => {
    for (const tab of NOTIFICATION_TABS) {
      expect(parseNotificationsPageQuery(buildNotificationsHref(tab).query)).toEqual({ tab });
    }
  });
});

describe('NOTIFICATION_TAB_LABEL_KEYS', () => {
  it('mỗi tab có đúng một khoá nhãn', () => {
    expect(Object.keys(NOTIFICATION_TAB_LABEL_KEYS).sort()).toEqual([...NOTIFICATION_TABS].sort());
  });
});
