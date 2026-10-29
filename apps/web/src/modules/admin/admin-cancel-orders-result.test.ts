import { describe, expect, it } from 'vitest';

import { mergeCancelResults, shortOrderId } from './admin-cancel-orders-result';
import type { AdminCancelShopOrdersResult } from './types';

const result = (
  overrides: Partial<AdminCancelShopOrdersResult> = {},
): AdminCancelShopOrdersResult => ({
  cancelled: 0,
  failed: [],
  needsManualRefund: [],
  refundsPending: 0,
  remaining: 0,
  ...overrides,
});

describe('mergeCancelResults', () => {
  it('lần đầu (chưa có gì trước đó): lấy nguyên kết quả của lần gọi', () => {
    const next = result({
      cancelled: 20,
      failed: [{ orderId: 'o-1', code: 'ORDER_INVALID_TRANSITION' }],
      needsManualRefund: [{ orderId: 'o-2', refundId: 'r-1', amount: '220000' }],
      refundsPending: 1,
      remaining: 5,
    });

    expect(mergeCancelResults(null, next)).toEqual(next);
  });

  it('số đã hủy và khoản hoàn chờ cổng CỘNG DỒN qua các lần gọi; remaining luôn là của lần gần nhất', () => {
    const first = mergeCancelResults(
      null,
      result({ cancelled: 20, refundsPending: 2, remaining: 7 }),
    );

    const second = mergeCancelResults(
      first,
      result({ cancelled: 7, refundsPending: 1, remaining: 0 }),
    );

    expect(second).toMatchObject({ cancelled: 27, refundsPending: 3, remaining: 0 });
  });

  it('đơn lỗi chỉ của lần GẦN NHẤT: đơn đã được hủy ở lần sau không còn hiện lỗi cũ', () => {
    const first = mergeCancelResults(
      null,
      result({
        cancelled: 1,
        failed: [{ orderId: 'o-1', code: 'PAYMENT_NOT_REFUNDABLE' }],
        remaining: 1,
      }),
    );

    const second = mergeCancelResults(first, result({ cancelled: 1, failed: [], remaining: 0 }));

    expect(second.failed).toEqual([]);
  });

  it('khoản hoàn bị từ chối cộng dồn qua các lần, và một khoản không bị đếm hai lần', () => {
    const a = { orderId: 'o-1', refundId: 'r-1', amount: '100000' };
    const b = { orderId: 'o-2', refundId: 'r-2', amount: '200000' };
    const first = mergeCancelResults(null, result({ needsManualRefund: [a] }));

    const second = mergeCancelResults(first, result({ needsManualRefund: [a, b] }));

    expect(second.needsManualRefund).toEqual([a, b]);
  });
});

describe('shortOrderId', () => {
  it('8 ký tự đầu của id, không viết hoa (khớp các màn đơn hàng khác)', () => {
    expect(shortOrderId('3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f')).toBe('3f2a9c1e');
    expect(shortOrderId('abc')).toBe('abc');
  });
});
