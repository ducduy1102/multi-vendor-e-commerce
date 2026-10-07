import {
  orderStatusSchema,
  orderTabSchema,
  paymentMethodSchema,
  paymentStatusSchema,
} from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  BUYER_ORDER_TAB_KEYS,
  ORDER_STATUS_DISPLAY,
  ORDER_TAB_LABEL_KEYS,
  PAYMENT_METHOD_LABEL_KEYS,
  PAYMENT_STATUS_LABEL_KEYS,
  SELLER_ORDER_TAB_KEYS,
} from './order-status-display';

// Key tra theo enum lúc chạy nên TypeScript không kiểm được key có tồn tại trong bản dịch hay
// không — thiếu key chỉ lộ ra khi UI hiện chuỗi key thô. Test này là lưới an toàn thay thế.
const locales = { vi: vi.order as Record<string, string>, en: en.order as Record<string, string> };

describe.each(Object.entries(locales))('bản dịch %s', (_locale, messages) => {
  it.each(orderStatusSchema.options)('trạng thái %s có nhãn', (status) => {
    expect(messages[ORDER_STATUS_DISPLAY[status].labelKey]).toBeTruthy();
  });

  it.each([...orderTabSchema.options, 'all' as const])('tab %s có nhãn', (tab) => {
    expect(messages[ORDER_TAB_LABEL_KEYS[tab]]).toBeTruthy();
  });

  it.each(paymentMethodSchema.options)('phương thức thanh toán %s có nhãn', (method) => {
    expect(messages[PAYMENT_METHOD_LABEL_KEYS[method]]).toBeTruthy();
  });

  it.each(paymentStatusSchema.options)('trạng thái thanh toán %s có nhãn', (status) => {
    expect(messages[PAYMENT_STATUS_LABEL_KEYS[status]]).toBeTruthy();
  });
});

describe('ORDER_STATUS_DISPLAY', () => {
  it('phủ đúng mọi OrderStatus (không thiếu, không thừa)', () => {
    expect(Object.keys(ORDER_STATUS_DISPLAY).sort()).toEqual([...orderStatusSchema.options].sort());
  });

  it('chưa thanh toán là cảnh báo (cần người mua hành động); hủy/hoàn tiền trung tính, không đỏ', () => {
    expect(ORDER_STATUS_DISPLAY.AWAITING_PAYMENT.tone).toBe('warning');
    expect(ORDER_STATUS_DISPLAY.CANCELLED.tone).toBe('muted');
    expect(ORDER_STATUS_DISPLAY.REFUNDED.tone).toBe('muted');
    expect(ORDER_STATUS_DISPLAY.COMPLETED.tone).toBe('success');
  });
});

describe('nhóm tab theo vai', () => {
  it('người mua: "Tất cả" rồi đủ 6 tab theo thứ tự enum dùng chung', () => {
    expect(BUYER_ORDER_TAB_KEYS).toEqual(['all', ...orderTabSchema.options]);
  });

  it('Seller: KHÔNG có tab "Chờ thanh toán" (đơn chưa trả tiền không lộ cho Seller)', () => {
    expect(SELLER_ORDER_TAB_KEYS).toEqual([
      'all',
      'pending',
      'processing',
      'shipping',
      'completed',
      'cancelled',
    ]);
    expect(SELLER_ORDER_TAB_KEYS).not.toContain('awaiting-payment');
  });
});
