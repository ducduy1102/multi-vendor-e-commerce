import { chatCursorSchema } from '@ecommerce/types';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type KeysetCursor,
} from '../../shared/utils/keyset-cursor';

// Con trỏ phân trang của chat: cặp (mốc thời gian, id) của dòng CUỐI trang trước (Week10.md 4.5). Định dạng và việc kiểm
// nghiêm ngặt nằm ở shared/utils/keyset-cursor.ts (dùng chung với thông báo); ở đây chỉ gắn schema bộ ký tự của chat.
export type ChatCursor = KeysetCursor;

export const encodeChatCursor = encodeKeysetCursor;

// null = con trỏ không hợp lệ (nơi gọi trả 400).
export function decodeChatCursor(raw: string): ChatCursor | null {
  return decodeKeysetCursor(raw, chatCursorSchema);
}
