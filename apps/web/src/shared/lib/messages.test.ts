import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';

type Messages = Record<string, Record<string, string>>;

// Namespace của Tuần 6 (Week6.md 3.9): mọi key phải có ở cả 2 ngôn ngữ, cùng
// placeholder, không rỗng — thiếu 1 phía next-intl không throw mà hiện chuỗi key
// thô hoặc rơi về ngôn ngữ khác, rất dễ lọt qua review.
const NAMESPACES = ['cart', 'voucher', 'checkout'] as const;

const viMessages = vi as unknown as Messages;
const enMessages = en as unknown as Messages;

// `(?=[,}])` — theo đúng ngữ pháp ICU MessageFormat, tên placeholder LUÔN theo ngay sau bởi `,`
// (có type/style, vd `{count, plural, ...}`) hoặc `}` (đơn giản, vd `{code}`). Không có lookahead này,
// literal text nằm sát `{` bên trong 1 nhánh `plural`/`select` (vd `{only # item left}`) bị bắt nhầm
// thành placeholder ("only") — phát hiện thật ở `checkout.outOfStockItemAvailable` khi đăng ký
// namespace `checkout` vào lưới này (Week7.md 3.9): bản dịch ICU plural đúng và chạy đúng thật (kiểm
// bằng `createTranslator`), chỉ riêng regex cũ báo nhầm "thiếu placeholder only ở bản vi".
function placeholders(message: string): string {
  return [...message.matchAll(/\{(\w+)(?=[,}])/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

describe.each(NAMESPACES)('messages: namespace "%s"', (namespace) => {
  const viKeys = Object.keys(viMessages[namespace]);
  const enKeys = Object.keys(enMessages[namespace]);

  it('vi và en có đúng cùng tập key', () => {
    expect([...viKeys].sort()).toEqual([...enKeys].sort());
  });

  it.each(viKeys)('%s: không rỗng và cùng placeholder ở vi/en', (key) => {
    const viText = viMessages[namespace][key];
    const enText = enMessages[namespace][key];

    expect(viText.trim()).not.toBe('');
    expect(enText.trim()).not.toBe('');
    expect(placeholders(enText)).toBe(placeholders(viText));
  });
});

it('header.cartLink có ở cả 2 ngôn ngữ', () => {
  expect(viMessages.header.cartLink).toBeTruthy();
  expect(enMessages.header.cartLink).toBeTruthy();
});

// Regression: "{count} items" hiện "1 items" khi giỏ chỉ có 1 sản phẩm.
describe('số nhiều tiếng Anh', () => {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'cart' });

  it('itemsCount: 1 item / N items', () => {
    expect(t('itemsCount', { count: 1 })).toBe('1 item');
    expect(t('itemsCount', { count: 2 })).toBe('2 items');
    expect(t('itemsCount', { count: 16 })).toBe('16 items');
  });

  it('quantityAdjusted: 1 item / N items', () => {
    expect(t('quantityAdjusted', { count: 1 })).toContain('1 item ');
    expect(t('quantityAdjusted', { count: 3 })).toContain('3 items ');
  });

  it('product.resultCount: 1 product / N products', () => {
    const tp = createTranslator({ locale: 'en', messages: en, namespace: 'product' });
    expect(tp('resultCount', { count: 1 })).toBe('1 product');
    expect(tp('resultCount', { count: 0 })).toBe('0 products');
    expect(tp('resultCount', { count: 12 })).toBe('12 products');
  });

  it('checkout.outOfStockItemAvailable: only 1 item left / only N items left (Week7.md 3.9)', () => {
    const tc = createTranslator({ locale: 'en', messages: en, namespace: 'checkout' });
    expect(tc('outOfStockItemAvailable', { available: 1 })).toBe('only 1 item left');
    expect(tc('outOfStockItemAvailable', { available: 0 })).toBe('only 0 items left');
    expect(tc('outOfStockItemAvailable', { available: 3 })).toBe('only 3 items left');
  });
});

describe('tiếng Việt không chia số nhiều', () => {
  const t = createTranslator({ locale: 'vi', messages: vi, namespace: 'cart' });

  it('itemsCount và quantityAdjusted dùng cùng 1 dạng', () => {
    expect(t('itemsCount', { count: 1 })).toBe('1 sản phẩm');
    expect(t('itemsCount', { count: 16 })).toBe('16 sản phẩm');
    expect(t('quantityAdjusted', { count: 2 })).toBe(
      'Đã điều chỉnh số lượng của 2 sản phẩm theo tồn kho hiện có',
    );
  });

  it('checkout.outOfStockItemAvailable dùng cùng 1 dạng dù available là 1 hay N', () => {
    const tc = createTranslator({ locale: 'vi', messages: vi, namespace: 'checkout' });
    expect(tc('outOfStockItemAvailable', { available: 1 })).toBe('chỉ còn 1 sản phẩm');
    expect(tc('outOfStockItemAvailable', { available: 5 })).toBe('chỉ còn 5 sản phẩm');
  });
});
