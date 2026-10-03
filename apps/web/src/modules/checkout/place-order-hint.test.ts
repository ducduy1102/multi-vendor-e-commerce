import { paymentMethodSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { getUnknownResultHintKey } from './place-order-hint';

describe('getUnknownResultHintKey', () => {
  it('COD không trừ tiền -> câu nhắc riêng, không nhắc "nếu tiền đã bị trừ"', () => {
    expect(getUnknownResultHintKey('COD')).toBe('placeOrderUnknownResultHintCod');
  });

  it.each(['VNPAY', 'MOMO'] as const)('%s (cổng online) -> câu nhắc về tiền như cũ', (method) => {
    expect(getUnknownResultHintKey(method)).toBe('placeOrderUnknownResultHint');
  });

  it('mọi phương thức đều ra key có bản dịch ở cả vi lẫn en (key tra động nên TypeScript không kiểm)', () => {
    const viCheckout = vi.checkout as Record<string, string>;
    const enCheckout = en.checkout as Record<string, string>;

    for (const method of paymentMethodSchema.options) {
      const key = getUnknownResultHintKey(method);
      expect(viCheckout[key], `vi ${key}`).toBeTruthy();
      expect(enCheckout[key], `en ${key}`).toBeTruthy();
    }
  });

  it('câu của COD không nói tới việc bị trừ tiền (cả vi lẫn en)', () => {
    expect(vi.checkout.placeOrderUnknownResultHintCod).not.toMatch(/tiền đã bị trừ/i);
    expect(en.checkout.placeOrderUnknownResultHintCod).not.toMatch(/charged/i);
  });
});
