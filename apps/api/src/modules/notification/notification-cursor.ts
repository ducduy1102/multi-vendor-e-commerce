import { notificationCursorSchema } from '@ecommerce/types';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type KeysetCursor,
} from '../../shared/utils/keyset-cursor';

// Con trỏ phân trang của danh sách thông báo: (createdAt, id) của thông báo CUỐI trang trước, khớp đúng thứ tự index
// (user_id, created_at DESC, id DESC). Định dạng dùng chung với chat (shared/utils/keyset-cursor.ts).
export type NotificationCursor = KeysetCursor;

export const encodeNotificationCursor = encodeKeysetCursor;

// null = con trỏ không hợp lệ (nơi gọi trả 400).
export function decodeNotificationCursor(
  raw: string,
): NotificationCursor | null {
  return decodeKeysetCursor(raw, notificationCursorSchema);
}
