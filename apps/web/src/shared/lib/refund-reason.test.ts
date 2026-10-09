import { REFUND_REASON_CODES } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { REFUND_REASON_LABEL_KEYS, getRefundReasonLabelKey } from './refund-reason';

describe('REFUND_REASON_LABEL_KEYS', () => {
  it('phủ đúng mọi mã lý do (không thiếu, không thừa)', () => {
    expect(Object.keys(REFUND_REASON_LABEL_KEYS).sort()).toEqual([...REFUND_REASON_CODES].sort());
  });

  it.each([
    ['vi', vi.order],
    ['en', en.order],
  ] as const)('mọi mã có nhãn ở namespace order (%s)', (_locale, messages) => {
    for (const code of REFUND_REASON_CODES) {
      expect(
        (messages as Record<string, string>)[REFUND_REASON_LABEL_KEYS[code]],
        code,
      ).toBeTruthy();
    }
  });
});

describe('getRefundReasonLabelKey', () => {
  it('mã đã biết -> nhãn của mã đó', () => {
    expect(getRefundReasonLabelKey('DAMAGED')).toBe('refundReasonDamaged');
  });

  it('mã BE thêm sau mà FE chưa biết -> "Lý do khác", không lộ mã thô', () => {
    expect(getRefundReasonLabelKey('SOME_FUTURE_REASON')).toBe('refundReasonOther');
    expect(getRefundReasonLabelKey('')).toBe('refundReasonOther');
  });

  it('không nhầm với thuộc tính có sẵn của Object (vd "toString", "constructor")', () => {
    expect(getRefundReasonLabelKey('toString')).toBe('refundReasonOther');
    expect(getRefundReasonLabelKey('constructor')).toBe('refundReasonOther');
  });
});
