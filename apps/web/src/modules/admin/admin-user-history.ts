import type { AdminUserHistoryEntry } from './types';

export type AdminUserHistoryKind = 'lock' | 'ban' | 'unlock';

export interface AdminUserHistoryDisplay {
  kind: AdminUserHistoryKind;
  titleKey: string;
  // Hệ quả với shop của lần đổi trạng thái đó (key + số shop); null = không có gì đáng nói.
  note: { key: string; count: number } | null;
}

function numberMeta(entry: AdminUserHistoryEntry, key: string): number | null {
  const value = entry.meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Một dòng nhật ký quản trị -> nhãn + ghi chú hiển thị. `action` là chuỗi tự do (BE cố ý không dùng enum để một hành động
// FE chưa biết không làm hỏng cả ngăn chi tiết): hành động lạ rơi về nhãn chung chứ không ném lỗi. Hướng đổi (`from` →
// `to`) lấy từ `meta` do BE ghi cùng lúc; thiếu meta thì rơi về nhãn theo `action` (Tạm khoá / Mở lại).
export function describeAdminUserHistoryEntry(
  entry: AdminUserHistoryEntry,
): AdminUserHistoryDisplay {
  if (entry.action === 'SUSPEND_USER') {
    const suspended = numberMeta(entry, 'shopsSuspended');
    return {
      kind: entry.meta.to === 'BANNED' ? 'ban' : 'lock',
      titleKey: entry.meta.to === 'BANNED' ? 'usersHistoryBan' : 'usersHistorySuspend',
      note:
        suspended !== null && suspended > 0
          ? { key: 'usersHistoryShopsSuspended', count: suspended }
          : null,
    };
  }

  if (entry.action === 'REACTIVATE_USER') {
    const reopened = numberMeta(entry, 'shopsReopened');
    const stillSuspended = numberMeta(entry, 'shopsStillSuspended');
    return {
      kind: 'unlock',
      titleKey: entry.meta.from === 'BANNED' ? 'usersHistoryUnban' : 'usersHistoryReactivate',
      note:
        reopened !== null && reopened > 0
          ? { key: 'usersHistoryShopsReopened', count: reopened }
          : stillSuspended !== null && stillSuspended > 0
            ? { key: 'usersHistoryShopsStillSuspended', count: stillSuspended }
            : null,
    };
  }

  return { kind: 'lock', titleKey: 'usersHistoryOther', note: null };
}
