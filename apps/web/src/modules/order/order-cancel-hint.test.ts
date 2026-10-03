import { orderStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { getCancelBlockedReasonKey } from './order-cancel-hint';
import type { OrderDetail } from './types';

type Input = Pick<OrderDetail, 'canCancel' | 'status' | 'paymentMethod'>;
const input = (overrides: Partial<Input>): Input => ({
  canCancel: false,
  status: 'PENDING',
  paymentMethod: 'VNPAY',
  ...overrides,
});

describe('getCancelBlockedReasonKey', () => {
  it('BE cho hủy (canCancel) -> không cần gợi ý, bất kể trạng thái', () => {
    for (const status of orderStatusSchema.options) {
      expect(getCancelBlockedReasonKey(input({ canCancel: true, status }))).toBeNull();
    }
  });

  it('đã thanh toán online, chờ shop xác nhận -> giải thích hủy đơn đã thanh toán chưa hỗ trợ', () => {
    expect(getCancelBlockedReasonKey(input({ status: 'PENDING', paymentMethod: 'VNPAY' }))).toBe(
      'cancelBlockedPaidOnline',
    );
    expect(getCancelBlockedReasonKey(input({ status: 'PENDING', paymentMethod: 'MOMO' }))).toBe(
      'cancelBlockedPaidOnline',
    );
  });

  it('PENDING mà phương thức chưa rõ (null) cũng coi như không phải COD -> giải thích', () => {
    expect(getCancelBlockedReasonKey(input({ status: 'PENDING', paymentMethod: null }))).toBe(
      'cancelBlockedPaidOnline',
    );
  });

  it('đơn COD chờ xác nhận mà BE vẫn không cho hủy -> không bịa lý do "đã thanh toán"', () => {
    expect(
      getCancelBlockedReasonKey(input({ status: 'PENDING', paymentMethod: 'COD' })),
    ).toBeNull();
  });

  it.each(['CONFIRMED', 'PACKED'] as const)(
    '%s -> giải thích shop đã xử lý nên không hủy được',
    (status) => {
      expect(getCancelBlockedReasonKey(input({ status }))).toBe('cancelBlockedProcessing');
    },
  );

  it('SHIPPING -> không hiện nút khoá: hàng đã giao đi, việc cần làm là "Đã nhận hàng"', () => {
    expect(getCancelBlockedReasonKey(input({ status: 'SHIPPING' }))).toBeNull();
  });

  it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const)(
    '%s mà không hủy được -> không hiện nút bị khoá (không có gì để giải thích)',
    (status) => {
      expect(getCancelBlockedReasonKey(input({ status }))).toBeNull();
    },
  );
});
