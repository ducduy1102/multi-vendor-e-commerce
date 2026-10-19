import { CHAT_PREVIEW_MAX_LENGTH } from '@ecommerce/types';

// Tin cuối hiện trong danh sách hội thoại: gộp mọi khoảng trắng/xuống dòng thành một dấu cách (danh sách là một
// dòng) rồi cắt theo KÝ TỰ (code point, không phải đơn vị UTF-16 nên không cắt đôi một emoji thường), thêm "…"
// khi bị cắt. Tổng độ dài kể cả dấu "…" không vượt `max`. BE cắt sẵn để FE không phải cắt lại và để danh sách
// không phải mang cả nội dung 1000 ký tự của mỗi hội thoại.
export function toPreview(
  content: string,
  max: number = CHAT_PREVIEW_MAX_LENGTH,
): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(singleLine);
  if (characters.length <= max) return singleLine;
  return `${characters.slice(0, max - 1).join('')}…`;
}
