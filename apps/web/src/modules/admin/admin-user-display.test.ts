import { accountStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  ADMIN_USER_ROLE_FILTERS,
  ADMIN_USER_STATUS_DISPLAY,
  ADMIN_USER_TABS,
  getAdminUserDateInfo,
  getAdminUsersEmptyKind,
  getUserInitial,
} from './admin-user-display';

const MESSAGES = [vi.admin, en.admin] as Record<string, string>[];

// Key tra theo enum lúc chạy nên TypeScript không kiểm được — test này đảm bảo mọi trạng thái/tab/bộ lọc đều có bản dịch ở CẢ
// vi lẫn en (thiếu key next-intl chỉ báo lỗi console rồi hiện key thô).
describe('ADMIN_USER_STATUS_DISPLAY', () => {
  it('có đủ mọi trạng thái của enum dùng chung', () => {
    expect(Object.keys(ADMIN_USER_STATUS_DISPLAY).sort()).toEqual(
      [...accountStatusSchema.options].sort(),
    );
  });

  it.each(accountStatusSchema.options)(
    '%s có nhãn và câu "danh sách trống" ở cả vi và en',
    (status) => {
      const { labelKey, emptyKey } = ADMIN_USER_STATUS_DISPLAY[status];

      for (const messages of MESSAGES) {
        expect(messages[labelKey]).toBeTruthy();
        expect(messages[emptyKey]).toBeTruthy();
      }
    },
  );

  it('sắc thái: đang dùng = success, tạm khoá = warning, bị cấm = destructive, tự xoá = muted (không dùng accent)', () => {
    expect(
      Object.fromEntries(
        accountStatusSchema.options.map((status) => [
          status,
          ADMIN_USER_STATUS_DISPLAY[status].tone,
        ]),
      ),
    ).toEqual({
      ACTIVE: 'success',
      SUSPENDED: 'warning',
      BANNED: 'destructive',
      DEACTIVATED: 'muted',
    });
  });
});

describe('ADMIN_USER_TABS', () => {
  it('"Tất cả" (không lọc) đứng đầu, rồi MỌI trạng thái theo thứ tự enum — không tab nào BE không lọc được', () => {
    expect(ADMIN_USER_TABS.map((tab) => tab.status)).toEqual([
      undefined,
      ...accountStatusSchema.options,
    ]);
  });

  it('mọi tab có nhãn ở cả vi và en', () => {
    for (const tab of ADMIN_USER_TABS) {
      for (const messages of MESSAGES) expect(messages[tab.labelKey]).toBeTruthy();
    }
  });
});

describe('ADMIN_USER_ROLE_FILTERS', () => {
  it('Tất cả vai, Người dùng, Quản trị viên — khớp enum vai của BE', () => {
    expect(ADMIN_USER_ROLE_FILTERS.map((filter) => filter.role)).toEqual([
      undefined,
      'USER',
      'ADMIN',
    ]);
    for (const filter of ADMIN_USER_ROLE_FILTERS) {
      for (const messages of MESSAGES) expect(messages[filter.labelKey]).toBeTruthy();
    }
  });
});

describe('getAdminUserDateInfo', () => {
  const BASE = { createdAt: '2026-01-01T00:00:00.000Z' };

  it('tạm khoá / cấm: hiện MỐC BỊ KHOÁ hoặc CẤM với chú thích tương ứng', () => {
    expect(
      getAdminUserDateInfo({
        ...BASE,
        accountStatus: 'SUSPENDED',
        statusChangedAt: '2026-10-25T10:00:00.000Z',
      }),
    ).toEqual({ at: '2026-10-25T10:00:00.000Z', captionKey: 'usersCaptionSuspendedAt' });
    expect(
      getAdminUserDateInfo({
        ...BASE,
        accountStatus: 'BANNED',
        statusChangedAt: '2026-10-26T10:00:00.000Z',
      }),
    ).toEqual({ at: '2026-10-26T10:00:00.000Z', captionKey: 'usersCaptionBannedAt' });
  });

  it('đang hoạt động hoặc đã tự xoá: hiện ngày tham gia, kể cả khi còn mốc đổi trạng thái cũ (đã mở lại)', () => {
    for (const accountStatus of ['ACTIVE', 'DEACTIVATED'] as const) {
      expect(
        getAdminUserDateInfo({
          ...BASE,
          accountStatus,
          statusChangedAt: '2026-10-25T10:00:00.000Z',
        }),
      ).toEqual({ at: BASE.createdAt, captionKey: 'usersCaptionJoined' });
    }
  });

  it('bị khoá nhưng thiếu mốc (dữ liệu cũ) -> rơi về ngày tham gia, không hiện ngày rỗng', () => {
    expect(
      getAdminUserDateInfo({ ...BASE, accountStatus: 'SUSPENDED', statusChangedAt: null }),
    ).toEqual({ at: BASE.createdAt, captionKey: 'usersCaptionJoined' });
  });

  it('mọi chú thích có bản dịch ở cả vi và en', () => {
    for (const key of ['usersCaptionJoined', 'usersCaptionSuspendedAt', 'usersCaptionBannedAt']) {
      for (const messages of MESSAGES) expect(messages[key]).toBeTruthy();
    }
  });
});

describe('getUserInitial', () => {
  it.each([
    ['Nguyễn Văn An', 'A'],
    ['  lê  quản trị  ', 'T'],
    ['Madonna', 'M'],
    ['Đặng', 'Đ'],
    ['😀 Vui', 'V'],
    ['😀', '😀'],
  ])('%j -> %s', (name, expected) => {
    expect(getUserInitial(name)).toBe(expected);
  });

  it('tên rỗng / toàn khoảng trắng -> "?" thay vì ném lỗi', () => {
    expect(getUserInitial('')).toBe('?');
    expect(getUserInitial('   ')).toBe('?');
  });
});

describe('getAdminUsersEmptyKind', () => {
  it.each([
    [{ q: 'an' }, 'search'],
    [{ q: 'an', role: 'ADMIN', status: 'BANNED' }, 'search'],
    [{ role: 'ADMIN' }, 'filter'],
    [{ role: 'USER', status: 'ACTIVE' }, 'filter'],
    [{ status: 'BANNED' }, 'tab'],
    [{}, 'all'],
  ] as const)('%j -> %s', (query, expected) => {
    expect(getAdminUsersEmptyKind({ ...query })).toBe(expected);
  });
});
