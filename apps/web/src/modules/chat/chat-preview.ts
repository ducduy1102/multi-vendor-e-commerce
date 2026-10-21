import { CHAT_PREVIEW_MAX_LENGTH } from '@ecommerce/types';

// Tin cuối hiện trong danh sách hội thoại — cùng quy tắc với BE (apps/api/src/modules/chat/chat-preview.ts): gộp mọi
// khoảng trắng/xuống dòng thành một dấu cách (danh sách là một dòng) rồi cắt theo KÝ TỰ (code point, không phải
// đơn vị UTF-16 nên không cắt đôi một emoji thường), thêm "…" khi bị cắt; tổng độ dài kể cả "…" không vượt `max`.
// FE cần bản riêng để cập nhật dòng "tin cuối" ngay khi có tin mới (qua real-time hoặc tin vừa gửi) mà không phải
// tải lại cả danh sách; hai bản phải giữ khớp nhau (chat-preview.test.ts dùng cùng bộ ca với BE).
export function toPreview(content: string, max: number = CHAT_PREVIEW_MAX_LENGTH): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(singleLine);
  if (characters.length <= max) return singleLine;
  return `${characters.slice(0, max - 1).join('')}…`;
}
