import {
  abnormalPaymentKindSchema,
  orderStatusSchema,
  paymentMethodSchema,
  paymentRefundStatusSchema,
  refundRequestKindSchema,
  refundRequestStatusSchema,
} from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY,
  ADMIN_DISPUTE_EMPTY_KEYS,
  ADMIN_LEDGER_EMPTY_KEYS,
  ADMIN_ORDER_STATUS_LABEL_KEYS,
  ADMIN_PAYMENT_METHOD_LABEL_KEYS,
  ADMIN_REFUND_LIST_LABEL_KEYS,
  ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS,
  ADMIN_REFUND_REQUEST_STATUS_DISPLAY,
  ADMIN_REFUND_STATUS_DISPLAY,
  getLatestSellerRejectionNote,
  getRefundOutcomeToast,
} from './admin-refund-display';
import {
  ADMIN_DISPUTE_FILTERS,
  ADMIN_LEDGER_FILTERS,
  ADMIN_REFUND_TABS,
} from './admin-refunds-href';

const admin = { vi: vi.admin as Record<string, string>, en: en.admin as Record<string, string> };
const order = { vi: vi.order as Record<string, string>, en: en.order as Record<string, string> };

describe.each(['vi', 'en'] as const)('bản dịch %s', (locale) => {
  it.each(refundRequestStatusSchema.options)('trạng thái yêu cầu %s có nhãn', (status) => {
    expect(admin[locale][ADMIN_REFUND_REQUEST_STATUS_DISPLAY[status].labelKey]).toBeTruthy();
  });

  it.each(refundRequestKindSchema.options)('loại yêu cầu %s có nhãn', (kind) => {
    expect(admin[locale][ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS[kind]]).toBeTruthy();
  });

  it.each(paymentRefundStatusSchema.options)('trạng thái khoản hoàn %s có nhãn', (status) => {
    expect(admin[locale][ADMIN_REFUND_STATUS_DISPLAY[status].labelKey]).toBeTruthy();
  });

  it.each(abnormalPaymentKindSchema.options)(
    'loại thanh toán bất thường %s có nhãn và câu giải thích',
    (kind) => {
      const display = ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY[kind];
      expect(admin[locale][display.labelKey]).toBeTruthy();
      expect(admin[locale][display.hintKey]).toBeTruthy();
    },
  );

  it.each(paymentMethodSchema.options)('cách thanh toán %s có nhãn', (method) => {
    expect(admin[locale][ADMIN_PAYMENT_METHOD_LABEL_KEYS[method]]).toBeTruthy();
  });

  it.each(orderStatusSchema.options)('trạng thái đơn %s có nhãn ở namespace order', (status) => {
    expect(order[locale][ADMIN_ORDER_STATUS_LABEL_KEYS[status]]).toBeTruthy();
  });

  it.each(ADMIN_REFUND_TABS)('tab %s có nhãn danh sách', (tab) => {
    expect(admin[locale][ADMIN_REFUND_LIST_LABEL_KEYS[tab]]).toBeTruthy();
  });

  it.each(ADMIN_DISPUTE_FILTERS)('bộ lọc khiếu nại %s có câu rỗng', (filter) => {
    expect(admin[locale][ADMIN_DISPUTE_EMPTY_KEYS[filter]]).toBeTruthy();
  });

  it.each(ADMIN_LEDGER_FILTERS)('bộ lọc sổ cái %s có câu rỗng', (filter) => {
    expect(admin[locale][ADMIN_LEDGER_EMPTY_KEYS[filter]]).toBeTruthy();
  });

  it.each(['SUCCEEDED', 'PENDING', 'FAILED'] as const)(
    'thông báo kết quả hoàn %s có bản dịch',
    (status) => {
      expect(admin[locale][getRefundOutcomeToast(status).messageKey]).toBeTruthy();
    },
  );
});

describe('phủ đủ enum (không thiếu, không thừa)', () => {
  it('trạng thái yêu cầu, loại yêu cầu, khoản hoàn, loại bất thường, cách thanh toán, trạng thái đơn', () => {
    expect(Object.keys(ADMIN_REFUND_REQUEST_STATUS_DISPLAY).sort()).toEqual(
      [...refundRequestStatusSchema.options].sort(),
    );
    expect(Object.keys(ADMIN_REFUND_REQUEST_KIND_LABEL_KEYS).sort()).toEqual(
      [...refundRequestKindSchema.options].sort(),
    );
    expect(Object.keys(ADMIN_REFUND_STATUS_DISPLAY).sort()).toEqual(
      [...paymentRefundStatusSchema.options].sort(),
    );
    expect(Object.keys(ADMIN_ABNORMAL_PAYMENT_KIND_DISPLAY).sort()).toEqual(
      [...abnormalPaymentKindSchema.options].sort(),
    );
    expect(Object.keys(ADMIN_PAYMENT_METHOD_LABEL_KEYS).sort()).toEqual(
      [...paymentMethodSchema.options].sort(),
    );
    expect(Object.keys(ADMIN_ORDER_STATUS_LABEL_KEYS).sort()).toEqual(
      [...orderStatusSchema.options].sort(),
    );
  });
});

describe('sắc thái', () => {
  it('yêu cầu đã lên sàn là việc của Admin (warning); đã chấp thuận là thành công; còn lại trung tính', () => {
    expect(ADMIN_REFUND_REQUEST_STATUS_DISPLAY.ESCALATED.tone).toBe('warning');
    expect(ADMIN_REFUND_REQUEST_STATUS_DISPLAY.APPROVED.tone).toBe('success');
    for (const status of [
      'PENDING_SELLER',
      'REJECTED_BY_SELLER',
      'REJECTED',
      'WITHDRAWN',
    ] as const) {
      expect(ADMIN_REFUND_REQUEST_STATUS_DISPLAY[status].tone, status).toBe('muted');
    }
  });

  it('khoản hoàn lỗi là destructive (phải gỡ), đang chờ cổng là warning, đã hoàn là success', () => {
    expect(ADMIN_REFUND_STATUS_DISPLAY.FAILED.tone).toBe('destructive');
    expect(ADMIN_REFUND_STATUS_DISPLAY.PENDING.tone).toBe('warning');
    expect(ADMIN_REFUND_STATUS_DISPLAY.SUCCEEDED.tone).toBe('success');
  });
});

describe('getLatestSellerRejectionNote', () => {
  const entry = (
    toStatus: Parameters<typeof getLatestSellerRejectionNote>[0][number]['toStatus'],
    actorType: Parameters<typeof getLatestSellerRejectionNote>[0][number]['actorType'],
    note: string | null,
    day: number,
  ) => ({ toStatus, actorType, note, createdAt: `2026-10-0${day}T00:00:00.000Z` });

  it('không có lịch sử / shop chưa từ chối -> null', () => {
    expect(getLatestSellerRejectionNote([])).toBeNull();
    expect(getLatestSellerRejectionNote([entry('PENDING_SELLER', 'BUYER', null, 1)])).toBeNull();
  });

  it('lấy ghi chú SELLER từ chối', () => {
    expect(
      getLatestSellerRejectionNote([
        entry('PENDING_SELLER', 'BUYER', null, 1),
        entry('REJECTED_BY_SELLER', 'SELLER', 'Hàng đã giao đúng mẫu', 2),
        entry('ESCALATED', 'BUYER', null, 3),
      ]),
    ).toBe('Hàng đã giao đúng mẫu');
  });

  it('có nhiều lần từ chối -> lấy lần GẦN NHẤT', () => {
    expect(
      getLatestSellerRejectionNote([
        entry('REJECTED_BY_SELLER', 'SELLER', 'Lần 1', 1),
        entry('REJECTED_BY_SELLER', 'SELLER', 'Lần 2', 2),
      ]),
    ).toBe('Lần 2');
  });

  it('bỏ ghi chú rỗng và ghi chú của hệ thống/Admin (có thể là chuỗi nội bộ)', () => {
    expect(
      getLatestSellerRejectionNote([entry('REJECTED_BY_SELLER', 'SELLER', null, 1)]),
    ).toBeNull();
    expect(getLatestSellerRejectionNote([entry('REJECTED_BY_SELLER', 'SELLER', '', 1)])).toBeNull();
    expect(
      getLatestSellerRejectionNote([
        entry('REJECTED_BY_SELLER', 'SELLER', 'Lý do thật', 1),
        entry('REJECTED', 'ADMIN', 'Ghi chú của Admin', 2),
        entry('ESCALATED', 'SYSTEM', 'Seller response deadline passed', 3),
      ]),
    ).toBe('Lý do thật');
  });

  it('chỉ tin ghi chú do SELLER nhập: bản ghi "từ chối bởi shop" mang actor khác (dữ liệu lạ) cũng bị bỏ qua', () => {
    expect(
      getLatestSellerRejectionNote([
        entry('REJECTED_BY_SELLER', 'SYSTEM', 'Seller response deadline passed', 1),
      ]),
    ).toBeNull();
    expect(
      getLatestSellerRejectionNote([entry('REJECTED_BY_SELLER', 'ADMIN', 'Ghi chú của Admin', 1)]),
    ).toBeNull();
    expect(
      getLatestSellerRejectionNote([entry('REJECTED_BY_SELLER', 'BUYER', 'internal', 1)]),
    ).toBeNull();
  });

  it('không sửa mảng gốc', () => {
    const history = [
      entry('REJECTED_BY_SELLER', 'SELLER', 'x', 1),
      entry('ESCALATED', 'BUYER', null, 2),
    ];
    const copy = [...history];

    getLatestSellerRejectionNote(history);

    expect(history).toEqual(copy);
  });
});

describe('getRefundOutcomeToast', () => {
  it('đã hoàn -> success; đang chờ cổng -> info; cổng từ chối -> error (200 không có nghĩa là tiền đã hoàn)', () => {
    expect(getRefundOutcomeToast('SUCCEEDED')).toEqual({
      type: 'success',
      messageKey: 'refundsOutcomeSucceeded',
    });
    expect(getRefundOutcomeToast('PENDING')).toEqual({
      type: 'info',
      messageKey: 'refundsOutcomePending',
    });
    expect(getRefundOutcomeToast('FAILED')).toEqual({
      type: 'error',
      messageKey: 'refundsOutcomeFailed',
    });
  });
});
