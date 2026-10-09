import {
  REFUND_REASON_CODES,
  paymentRefundStatusSchema,
  refundRequestKindSchema,
  refundRequestStatusSchema,
} from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  REFUND_REASON_LABEL_KEYS,
  REFUND_REQUEST_STATUS_DISPLAY,
  REFUND_REQUEST_TITLE_KEYS,
  describeOrderRefund,
  getRefundReasonLabelKey,
} from './refund-request-display';

const locales = { vi: vi.order as Record<string, string>, en: en.order as Record<string, string> };

describe.each(Object.entries(locales))('bản dịch %s', (_locale, messages) => {
  it.each(REFUND_REASON_CODES)('lý do %s có nhãn', (code) => {
    expect(messages[REFUND_REASON_LABEL_KEYS[code]]).toBeTruthy();
  });

  it.each(refundRequestStatusSchema.options)('trạng thái yêu cầu %s có nhãn', (status) => {
    expect(messages[REFUND_REQUEST_STATUS_DISPLAY[status].labelKey]).toBeTruthy();
  });

  it.each(refundRequestKindSchema.options)('loại yêu cầu %s có tiêu đề', (kind) => {
    expect(messages[REFUND_REQUEST_TITLE_KEYS[kind]]).toBeTruthy();
  });

  it.each(paymentRefundStatusSchema.options)('khoản hoàn %s có câu mô tả', (status) => {
    const { labelKey } = describeOrderRefund({ status, amount: '1000' });
    expect(messages[labelKey]).toBeTruthy();
  });
});

describe('REFUND_REASON_LABEL_KEYS', () => {
  it('phủ đúng mọi mã lý do (không thiếu, không thừa)', () => {
    expect(Object.keys(REFUND_REASON_LABEL_KEYS).sort()).toEqual([...REFUND_REASON_CODES].sort());
  });
});

describe('getRefundReasonLabelKey', () => {
  it('mã đã biết -> nhãn của mã đó', () => {
    expect(getRefundReasonLabelKey('DAMAGED')).toBe('refundReasonDamaged');
  });

  it('mã BE thêm sau mà FE chưa biết -> rơi về "Lý do khác", không lộ mã thô', () => {
    expect(getRefundReasonLabelKey('SOME_FUTURE_REASON')).toBe('refundReasonOther');
    expect(getRefundReasonLabelKey('')).toBe('refundReasonOther');
  });

  it('không nhầm với thuộc tính có sẵn của Object (vd "toString", "constructor")', () => {
    expect(getRefundReasonLabelKey('toString')).toBe('refundReasonOther');
    expect(getRefundReasonLabelKey('constructor')).toBe('refundReasonOther');
  });
});

describe('REFUND_REQUEST_STATUS_DISPLAY', () => {
  it('phủ đúng mọi trạng thái yêu cầu', () => {
    expect(Object.keys(REFUND_REQUEST_STATUS_DISPLAY).sort()).toEqual(
      [...refundRequestStatusSchema.options].sort(),
    );
  });

  it('bị shop từ chối là cảnh báo (người mua khiếu nại được); đã chấp thuận là thành công; không dùng đỏ', () => {
    expect(REFUND_REQUEST_STATUS_DISPLAY.REJECTED_BY_SELLER.tone).toBe('warning');
    expect(REFUND_REQUEST_STATUS_DISPLAY.APPROVED.tone).toBe('success');
    for (const { tone } of Object.values(REFUND_REQUEST_STATUS_DISPLAY)) {
      expect(['warning', 'neutral', 'success', 'muted', 'primary']).toContain(tone);
    }
  });
});

describe('describeOrderRefund', () => {
  it('đã hoàn -> câu "Đã hoàn {amount}" kèm số tiền', () => {
    expect(describeOrderRefund({ status: 'SUCCEEDED', amount: '320000' })).toEqual({
      labelKey: 'refundSucceeded',
      amount: '320000',
    });
  });

  it('đang hoàn -> câu "Đang hoàn {amount}" kèm số tiền', () => {
    expect(describeOrderRefund({ status: 'PENDING', amount: '320000' })).toEqual({
      labelKey: 'refundPending',
      amount: '320000',
    });
  });

  it('gặp sự cố -> câu không nêu số tiền (không hứa số tiền/thời hạn khi chưa hoàn được)', () => {
    expect(describeOrderRefund({ status: 'FAILED', amount: '320000' })).toEqual({
      labelKey: 'refundFailed',
      amount: null,
    });
  });

  it('câu hiển thị thật có chỗ cho số tiền ở khoản đã hoàn/đang hoàn và không lộ lý do lỗi nội bộ', () => {
    expect(locales.vi.refundSucceeded).toContain('{amount}');
    expect(locales.vi.refundPending).toContain('{amount}');
    expect(locales.en.refundSucceeded).toContain('{amount}');
    expect(locales.en.refundPending).toContain('{amount}');
    expect(locales.vi.refundFailed).not.toContain('{amount}');
  });
});
