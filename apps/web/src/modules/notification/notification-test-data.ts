import type { NotificationsData } from './hooks/notification-cache';
import type { Notification } from './types';

// Dữ liệu mẫu CHỈ cho test của module notification (không import từ mã chạy thật). Mọi id đều là UUID hợp lệ vì payload
// real-time và response API đi qua Zod `.uuid()`.

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const ORDER_ID = uuid(3001);
export const SHOP_ID = uuid(2001);
export const PRODUCT_ID = uuid(4001);

// Mốc thời gian ISO cố định: `at(0)` là gốc, mỗi đơn vị là một giây.
export function at(seconds: number): string {
  return new Date(Date.parse('2030-01-02T12:00:00.000Z') + seconds * 1000).toISOString();
}

interface BaseOverrides {
  id?: string;
  readAt?: string | null;
  createdAt?: string;
}

// Thông báo `ORDER_NEW` (chủ shop có đơn mới) — loại đơn giản nhất.
export function makeNotification(
  overrides: BaseOverrides & { orderId?: string } = {},
): Notification {
  const { orderId = ORDER_ID, ...base } = overrides;
  return {
    id: uuid(1),
    readAt: null,
    createdAt: at(0),
    type: 'ORDER_NEW',
    data: { orderId },
    ...base,
  };
}

// Thông báo loại lạ (BE mới hơn FE): schema đọc đã đưa về `UNKNOWN` với `data` rỗng.
export function makeUnknownNotification(overrides: BaseOverrides = {}): Notification {
  return {
    id: uuid(2),
    readAt: null,
    createdAt: at(0),
    type: 'UNKNOWN',
    data: {},
    ...overrides,
  };
}

// Mỗi mảng là một trang (mới nhất trước); `nextCursor` là 'cursor-<chỉ số trang kế>' trừ trang cuối là null.
export function notificationsData(...pages: Notification[][]): NotificationsData {
  return {
    pages: pages.map((items, index) => ({
      items,
      nextCursor: index < pages.length - 1 ? `cursor-${index + 1}` : null,
    })),
    pageParams: pages.map((_, index) => (index === 0 ? undefined : `cursor-${index}`)),
  };
}
