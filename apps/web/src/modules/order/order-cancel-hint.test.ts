import { orderStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { getCancelBlockedReasonKey } from './order-cancel-hint';
import type { OrderDetail } from './types';

type Input = Pick<OrderDetail, 'canCancel' | 'canRequestCancel' | 'status' | 'refundRequest'>;
const input = (overrides: Partial<Input>): Input => ({
  canCancel: false,
  canRequestCancel: false,
  status: 'CONFIRMED',
  refundRequest: null,
  ...overrides,
});

describe('getCancelBlockedReasonKey', () => {
  it('BE cho hủy ngay (canCancel) -> không cần gợi ý, bất kể trạng thái', () => {
    for (const status of orderStatusSchema.options) {
      expect(getCancelBlockedReasonKey(input({ canCancel: true, status }))).toBeNull();
    }
  });

  it('BE cho gửi yêu cầu hủy (canRequestCancel) -> không cần gợi ý (đã có nút "Yêu cầu hủy")', () => {
    for (const status of ['CONFIRMED', 'PACKED'] as const) {
      expect(getCancelBlockedReasonKey(input({ canRequestCancel: true, status }))).toBeNull();
    }
  });

  it.each(['CONFIRMED', 'PACKED'] as const)(
    '%s, không hủy được và không gửi được yêu cầu, chưa có yêu cầu nào -> giải thích',
    (status) => {
      expect(getCancelBlockedReasonKey(input({ status }))).toBe('cancelBlockedProcessing');
    },
  );

  it.each(['PENDING_SELLER', 'REJECTED_BY_SELLER', 'ESCALATED', 'APPROVED', 'REJECTED'] as const)(
    'đã có yêu cầu (%s) -> KHÔNG hiện nút khoá: thẻ yêu cầu ở chi tiết đơn tự nói rõ trạng thái',
    (requestStatus) => {
      const refundRequest = { status: requestStatus } as OrderDetail['refundRequest'];

      expect(getCancelBlockedReasonKey(input({ refundRequest }))).toBeNull();
    },
  );

  it('SHIPPING -> không hiện nút khoá: hàng đã giao đi, việc cần làm là "Đã nhận hàng"', () => {
    expect(getCancelBlockedReasonKey(input({ status: 'SHIPPING' }))).toBeNull();
  });

  it.each(['AWAITING_PAYMENT', 'PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const)(
    '%s mà không hủy được -> không hiện nút bị khoá (không có gì để giải thích)',
    (status) => {
      expect(getCancelBlockedReasonKey(input({ status }))).toBeNull();
    },
  );

  it('đơn PENDING đã thanh toán online KHÔNG còn gợi ý "chưa hỗ trợ hủy" (BE cho hủy ngay kèm hoàn tiền)', () => {
    // Nhánh cũ `cancelBlockedPaidOnline` đã bỏ: nếu BE vì lý do nào đó không bật canCancel cho đơn này thì
    // cũng không bịa lý do — hàm chỉ giải thích ca CONFIRMED/PACKED.
    expect(getCancelBlockedReasonKey(input({ status: 'PENDING' }))).toBeNull();
  });
});
