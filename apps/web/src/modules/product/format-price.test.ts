import { describe, expect, it } from 'vitest';

import { formatPrice } from './format-price';

// Intl.NumberFormat cho 'vi-VN' chèn NBSP (U+00A0, không phải space
// thường  ) giữa số và ký hiệu ₫ — so sánh trực tiếp với chuỗi literal
// dùng space thường trong source sẽ luôn fail dù giá trị hiển thị đúng.
// Chuẩn hoá mọi khoảng trắng Unicode (\s khớp cả NBSP) về 1 space thường
// trước khi so sánh.
function normalizeSpaces(value: string): string {
  return value.replace(/\s/g, ' ');
}

describe('formatPrice', () => {
  it('formats a whole VND amount with vi-VN grouping and currency symbol', () => {
    expect(normalizeSpaces(formatPrice('100000'))).toBe('100.000 ₫');
  });

  it('formats zero correctly', () => {
    expect(normalizeSpaces(formatPrice('0'))).toBe('0 ₫');
  });

  it('applies grouping separator for large amounts (multiple thousand groups)', () => {
    expect(normalizeSpaces(formatPrice('1234567'))).toBe('1.234.567 ₫');
  });

  it('rounds decimal input to whole VND (VND has no minor unit)', () => {
    expect(normalizeSpaces(formatPrice('1500.5'))).toBe('1.501 ₫');
  });
});
