import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { describeAdminUserHistoryEntry } from './admin-user-history';
import type { AdminUserHistoryEntry } from './types';

const entry = (
  action: string,
  meta: AdminUserHistoryEntry['meta'] = {},
): AdminUserHistoryEntry => ({
  id: 'h-1',
  action,
  actorId: 'admin-1',
  actorName: 'Lê Quản Trị',
  reason: 'Lý do',
  meta,
  createdAt: '2026-10-25T10:00:00.000Z',
});

describe('describeAdminUserHistoryEntry', () => {
  it('tạm khoá: nhãn "Tạm khoá", kèm số shop bị tạm ngừng', () => {
    expect(
      describeAdminUserHistoryEntry(
        entry('SUSPEND_USER', { from: 'ACTIVE', to: 'SUSPENDED', shopsSuspended: 2 }),
      ),
    ).toEqual({
      kind: 'lock',
      titleKey: 'usersHistorySuspend',
      note: { key: 'usersHistoryShopsSuspended', count: 2 },
    });
  });

  it('cấm: nhãn "Cấm" (kể cả nâng từ tạm khoá lên cấm), không ghi chú khi không có shop nào bị kéo theo', () => {
    expect(
      describeAdminUserHistoryEntry(
        entry('SUSPEND_USER', { from: 'SUSPENDED', to: 'BANNED', shopsSuspended: 0 }),
      ),
    ).toEqual({ kind: 'ban', titleKey: 'usersHistoryBan', note: null });
  });

  it('mở lại từ tạm khoá: nhãn "Mở lại", kèm số shop được tự mở lại', () => {
    expect(
      describeAdminUserHistoryEntry(
        entry('REACTIVATE_USER', { from: 'SUSPENDED', to: 'ACTIVE', shopsReopened: 1 }),
      ),
    ).toEqual({
      kind: 'unlock',
      titleKey: 'usersHistoryReactivate',
      note: { key: 'usersHistoryShopsReopened', count: 1 },
    });
  });

  it('gỡ cấm: nhãn "Gỡ cấm"; shop KHÔNG tự mở nên ghi chú nói số shop vẫn tạm ngừng', () => {
    expect(
      describeAdminUserHistoryEntry(
        entry('REACTIVATE_USER', { from: 'BANNED', to: 'ACTIVE', shopsStillSuspended: 3 }),
      ),
    ).toEqual({
      kind: 'unlock',
      titleKey: 'usersHistoryUnban',
      note: { key: 'usersHistoryShopsStillSuspended', count: 3 },
    });
  });

  it('gỡ cấm khi không có shop nào: không ghi chú', () => {
    expect(
      describeAdminUserHistoryEntry(
        entry('REACTIVATE_USER', { from: 'BANNED', to: 'ACTIVE', shopsStillSuspended: 0 }),
      ).note,
    ).toBeNull();
  });

  it('thiếu meta (dòng cũ / meta hỏng): rơi về nhãn theo `action`, không ném lỗi', () => {
    expect(describeAdminUserHistoryEntry(entry('SUSPEND_USER')).titleKey).toBe(
      'usersHistorySuspend',
    );
    expect(describeAdminUserHistoryEntry(entry('REACTIVATE_USER')).titleKey).toBe(
      'usersHistoryReactivate',
    );
  });

  it('số trong meta sai kiểu (chuỗi, NaN) bị bỏ qua thay vì hiện "NaN shop"', () => {
    expect(
      describeAdminUserHistoryEntry(entry('SUSPEND_USER', { to: 'SUSPENDED', shopsSuspended: '2' }))
        .note,
    ).toBeNull();
    expect(
      describeAdminUserHistoryEntry(
        entry('SUSPEND_USER', { to: 'SUSPENDED', shopsSuspended: Number.NaN }),
      ).note,
    ).toBeNull();
  });

  it('hành động FE chưa biết -> nhãn chung, không ném lỗi', () => {
    expect(describeAdminUserHistoryEntry(entry('SOMETHING_NEW'))).toEqual({
      kind: 'lock',
      titleKey: 'usersHistoryOther',
      note: null,
    });
  });

  it('mọi key nhãn và ghi chú có bản dịch ở cả vi và en', () => {
    const keys = [
      'usersHistorySuspend',
      'usersHistoryBan',
      'usersHistoryReactivate',
      'usersHistoryUnban',
      'usersHistoryOther',
      'usersHistoryShopsSuspended',
      'usersHistoryShopsReopened',
      'usersHistoryShopsStillSuspended',
    ];
    for (const messages of [vi.admin, en.admin] as Record<string, string>[]) {
      for (const key of keys) expect(messages[key], key).toBeTruthy();
    }
  });
});
