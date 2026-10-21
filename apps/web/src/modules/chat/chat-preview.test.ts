import { CHAT_PREVIEW_MAX_LENGTH } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { toPreview } from './chat-preview';

const chars = (value: string) => Array.from(value).length;

// Cùng bộ ca với BE (apps/api/src/modules/chat/chat-preview.spec.ts): hai bản phải cho cùng kết quả, vì FE tự cập nhật
// dòng "tin cuối" khi có tin mới còn BE là nguồn khi tải danh sách.
describe('toPreview', () => {
  it.each([
    ['tin ngắn giữ nguyên', 'xin chào', 'xin chào'],
    ['xuống dòng thành dấu cách', 'dòng 1\ndòng 2', 'dòng 1 dòng 2'],
    ['nhiều khoảng trắng/xuống dòng liên tiếp gộp thành một dấu cách', 'a \n\n  b\t\tc', 'a b c'],
    ['cắt khoảng trắng hai đầu', '   hi   ', 'hi'],
    ['rỗng', '', ''],
    ['chỉ khoảng trắng', ' \n ', ''],
  ])('%s', (_name, input, expected) => {
    expect(toPreview(input)).toBe(expected);
  });

  it(`đúng ${CHAT_PREVIEW_MAX_LENGTH} ký tự thì giữ nguyên, không thêm "…"`, () => {
    const exact = 'a'.repeat(CHAT_PREVIEW_MAX_LENGTH);

    expect(toPreview(exact)).toBe(exact);
  });

  it(`${CHAT_PREVIEW_MAX_LENGTH + 1} ký tự bị cắt, thêm "…", tổng đúng ${CHAT_PREVIEW_MAX_LENGTH}`, () => {
    const result = toPreview('a'.repeat(CHAT_PREVIEW_MAX_LENGTH + 1));

    expect(chars(result)).toBe(CHAT_PREVIEW_MAX_LENGTH);
    expect(result).toBe(`${'a'.repeat(CHAT_PREVIEW_MAX_LENGTH - 1)}…`);
  });

  it('tin 1000 ký tự cũng chỉ ra đúng độ dài xem trước', () => {
    expect(chars(toPreview('x'.repeat(1000)))).toBe(CHAT_PREVIEW_MAX_LENGTH);
  });

  it('cắt theo KÝ TỰ chứ không theo đơn vị UTF-16: không cắt đôi emoji', () => {
    const result = toPreview('😀'.repeat(CHAT_PREVIEW_MAX_LENGTH + 5));

    expect(chars(result)).toBe(CHAT_PREVIEW_MAX_LENGTH);
    expect(result).toBe(`${'😀'.repeat(CHAT_PREVIEW_MAX_LENGTH - 1)}…`);
    expect(result).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('tham số max tuỳ chỉnh', () => {
    expect(toPreview('abcdefghij', 5)).toBe('abcd…');
    expect(toPreview('abcde', 5)).toBe('abcde');
  });

  it('nội dung độc hại giữ nguyên là chữ (không HTML hoá ở đây)', () => {
    expect(toPreview('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});
