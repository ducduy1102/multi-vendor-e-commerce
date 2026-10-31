import { describe, expect, it } from 'vitest';

import {
  adminAppealListQueryKey,
  adminAppealListsQueryKey,
  adminReportDetailQueryKey,
  adminReportDetailsQueryKey,
  adminReportListQueryKey,
  adminReportListsQueryKey,
  adminRefundListQueryKey,
  adminRefundListsQueryKey,
  adminRefundRequestListQueryKey,
  adminRefundRequestListsQueryKey,
  adminRefundablePaymentListQueryKey,
  adminRefundablePaymentListsQueryKey,
  adminShopListQueryKey,
  adminShopListsQueryKey,
  adminUserDetailQueryKey,
  adminUserDetailsQueryKey,
  adminUserListQueryKey,
  adminUserListsQueryKey,
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

describe('admin user query keys', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để invalidate mọi tab/bộ lọc/trang', () => {
    expect(
      adminUserListQueryKey({ status: 'BANNED', role: 'USER', q: 'an', page: 2 }).slice(0, 3),
    ).toEqual(adminUserListsQueryKey());
  });

  it('mỗi bộ lọc, từ khoá và trang là một key riêng (không dùng chung cache)', () => {
    const base = adminUserListQueryKey({ status: 'ACTIVE' });

    expect(base).not.toEqual(adminUserListQueryKey({ status: 'BANNED' }));
    expect(base).not.toEqual(adminUserListQueryKey({ status: 'ACTIVE', role: 'ADMIN' }));
    expect(base).not.toEqual(adminUserListQueryKey({ status: 'ACTIVE', q: 'an' }));
    expect(base).not.toEqual(adminUserListQueryKey({ status: 'ACTIVE', page: 2 }));
  });

  it('danh sách và chi tiết là hai nhánh riêng: làm mới một bên không bắt buộc kéo theo bên kia', () => {
    expect(adminUserListsQueryKey()).toEqual(['admin', 'users', 'list']);
    expect(adminUserDetailsQueryKey()).toEqual(['admin', 'users', 'detail']);
    expect(adminUserDetailQueryKey('u-1').slice(0, 3)).toEqual(adminUserDetailsQueryKey());
    expect(adminUserDetailQueryKey('u-1')).not.toEqual(adminUserDetailQueryKey('u-2'));
  });

  it('không đụng nhánh shop', () => {
    expect(adminUserListsQueryKey().slice(0, 2)).not.toEqual(adminShopListsQueryKey().slice(0, 2));
  });
});

describe('admin query keys — kháng nghị (Week11.md 4.6)', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để làm mới mọi tab/trang', () => {
    expect(adminAppealListQueryKey({ status: 'CLOSED', page: 2 }).slice(0, 3)).toEqual(
      adminAppealListsQueryKey(),
    );
  });

  it('mỗi tab và mỗi trang là một key riêng (không dùng chung cache)', () => {
    expect(adminAppealListQueryKey({ status: 'PENDING' })).not.toEqual(
      adminAppealListQueryKey({ status: 'CLOSED' }),
    );
    expect(adminAppealListQueryKey({ page: 1 })).not.toEqual(adminAppealListQueryKey({ page: 2 }));
  });

  it('nhánh "appeals" riêng — làm mới kháng nghị không kéo theo cache danh sách shop hay người dùng', () => {
    expect(adminAppealListsQueryKey().slice(0, 2)).toEqual(['admin', 'appeals']);
    expect(adminAppealListsQueryKey()).not.toEqual(adminShopListsQueryKey());
  });
});

describe('admin query keys — báo cáo vi phạm (Week11.md 5.6)', () => {
  it('key danh sách bắt đầu bằng tiền tố dùng để làm mới mọi tab / loại / trang', () => {
    expect(adminReportListQueryKey({ status: 'OPEN', page: 2 }).slice(0, 3)).toEqual(
      adminReportListsQueryKey(),
    );
  });

  it('mỗi tab, loại và trang là một key riêng (không dùng chung cache)', () => {
    const keys = [
      adminReportListQueryKey({ status: 'OPEN', page: 1 }),
      adminReportListQueryKey({ status: 'CLOSED', page: 1 }),
      adminReportListQueryKey({ status: 'OPEN', targetType: 'SHOP', page: 1 }),
      adminReportListQueryKey({ status: 'OPEN', page: 2 }),
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(4);
  });

  it('chi tiết theo id báo cáo, có tiền tố riêng và KHÔNG nằm trong tiền tố danh sách (làm mới danh sách không xoá chi tiết đang xem)', () => {
    expect(adminReportDetailQueryKey('r1').slice(0, 3)).toEqual(adminReportDetailsQueryKey());
    expect(adminReportDetailQueryKey('r1')).not.toEqual(adminReportDetailQueryKey('r2'));
    expect(adminReportDetailQueryKey('r1').slice(0, 3)).not.toEqual(adminReportListsQueryKey());
  });

  it('nằm trong nhánh "admin" nhưng khác nhánh kháng nghị và shop', () => {
    expect(adminReportListsQueryKey()[0]).toBe('admin');
    expect(adminReportListsQueryKey()[1]).toBe('reports');
    expect(adminReportListsQueryKey()).not.toEqual(adminAppealListsQueryKey());
  });
});
