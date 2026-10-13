import { describe, expect, it } from 'vitest';

import {
  adminRefundListQueryKey,
  adminRefundListsQueryKey,
  adminRefundRequestListQueryKey,
  adminRefundRequestListsQueryKey,
  adminRefundablePaymentListQueryKey,
  adminRefundablePaymentListsQueryKey,
  adminShopListQueryKey,
  adminShopListsQueryKey,
} from './admin-query-keys';

describe('admin query keys', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để invalidate mọi tab/trang', () => {
    expect(adminShopListQueryKey({ status: 'PENDING', page: 2 }).slice(0, 3)).toEqual(
      adminShopListsQueryKey(),
    );
  });

  it('mỗi tab và mỗi trang là 1 key riêng (không dùng chung cache)', () => {
    expect(adminShopListQueryKey({ status: 'PENDING' })).not.toEqual(
      adminShopListQueryKey({ status: 'REJECTED' }),
    );
    expect(adminShopListQueryKey({ page: 1 })).not.toEqual(adminShopListQueryKey({ page: 2 }));
  });

  it('tiền tố là nhánh "admin" riêng — làm mới danh sách shop không kéo theo cache của module khác', () => {
    expect(adminShopListsQueryKey().slice(0, 2)).toEqual(['admin', 'shops']);
  });

  it('mỗi màn hoàn tiền có tiền tố riêng, key danh sách bắt đầu bằng đúng tiền tố của màn đó', () => {
    expect(adminRefundRequestListQueryKey({ status: 'ESCALATED', page: 2 }).slice(0, 3)).toEqual(
      adminRefundRequestListsQueryKey(),
    );
    expect(adminRefundListQueryKey({ status: 'FAILED' }).slice(0, 3)).toEqual(
      adminRefundListsQueryKey(),
    );
    expect(adminRefundablePaymentListQueryKey({ page: 2 }).slice(0, 3)).toEqual(
      adminRefundablePaymentListsQueryKey(),
    );
    // Ba tiền tố đôi một khác nhau — làm mới màn này không kéo theo màn kia (và không đụng danh sách shop).
    const prefixes = [
      adminShopListsQueryKey(),
      adminRefundRequestListsQueryKey(),
      adminRefundListsQueryKey(),
      adminRefundablePaymentListsQueryKey(),
    ].map((key) => key.slice(0, 2).join('/'));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('mỗi tab và mỗi trang của màn hoàn tiền là 1 key riêng', () => {
    expect(adminRefundRequestListQueryKey({ status: 'ESCALATED' })).not.toEqual(
      adminRefundRequestListQueryKey({ status: 'PENDING_SELLER' }),
    );
    expect(adminRefundListQueryKey({ status: 'NEEDS_ACTION' })).not.toEqual(
      adminRefundListQueryKey({ status: 'SUCCEEDED' }),
    );
    expect(adminRefundablePaymentListQueryKey({ page: 1 })).not.toEqual(
      adminRefundablePaymentListQueryKey({ page: 2 }),
    );
  });
});
