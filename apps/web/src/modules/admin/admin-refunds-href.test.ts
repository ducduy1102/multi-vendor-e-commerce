import { adminRefundListFilterSchema, adminRefundRequestListQuerySchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  ADMIN_DISPUTE_FILTERS,
  ADMIN_DISPUTE_FILTER_LABEL_KEYS,
  ADMIN_LEDGER_FILTERS,
  ADMIN_LEDGER_FILTER_LABEL_KEYS,
  ADMIN_REFUND_TABS,
  ADMIN_REFUND_TAB_LABEL_KEYS,
  buildAdminRefundsHref,
  buildAdminRefundsPagination,
  parseAdminRefundsPageQuery,
  toAdminRefundsHrefInput,
  type AdminRefundsPageQuery,
} from './admin-refunds-href';

describe('parseAdminRefundsPageQuery', () => {
  it('không có param -> tab khiếu nại, bộ lọc "chờ sàn xử lý", trang 1', () => {
    expect(parseAdminRefundsPageQuery({})).toEqual({
      tab: 'disputes',
      status: 'ESCALATED',
      page: 1,
    });
  });

  it('?tab=failed không status -> bộ lọc mặc định của tab đó (NEEDS_ACTION), không phải của tab khác', () => {
    expect(parseAdminRefundsPageQuery({ tab: 'failed' })).toEqual({
      tab: 'failed',
      status: 'NEEDS_ACTION',
      page: 1,
    });
  });

  it('?tab=payments -> không có status (tab này không có bộ lọc con), kể cả khi URL cố gắng gắn status', () => {
    expect(parseAdminRefundsPageQuery({ tab: 'payments', status: 'FAILED', page: '2' })).toEqual({
      tab: 'payments',
      page: 2,
    });
  });

  it.each(['ESCALATED', 'PENDING_SELLER'])('tab khiếu nại nhận ?status=%s', (status) => {
    expect(parseAdminRefundsPageQuery({ status })).toMatchObject({ tab: 'disputes', status });
  });

  it.each(['NEEDS_ACTION', 'PENDING', 'FAILED', 'SUCCEEDED'])(
    'tab hoàn tiền lỗi nhận ?status=%s',
    (status) => {
      expect(parseAdminRefundsPageQuery({ tab: 'failed', status })).toMatchObject({
        tab: 'failed',
        status,
      });
    },
  );

  it('status của tab này sai ở tab kia -> rơi về mặc định của tab đang xem (kiểm theo tab)', () => {
    expect(parseAdminRefundsPageQuery({ tab: 'disputes', status: 'FAILED' })).toMatchObject({
      status: 'ESCALATED',
    });
    expect(parseAdminRefundsPageQuery({ tab: 'failed', status: 'ESCALATED' })).toMatchObject({
      status: 'NEEDS_ACTION',
    });
  });

  it.each(['APPROVED', 'WITHDRAWN', 'escalated', 'foo', '', 'toString'])(
    'tab khiếu nại: ?status=%j không phải bộ lọc FE cung cấp -> mặc định',
    (status) => {
      expect(parseAdminRefundsPageQuery({ status })).toMatchObject({ status: 'ESCALATED' });
    },
  );

  it.each(['Disputes', 'payment', 'foo', '', 'constructor'])(
    '?tab=%j không hợp lệ -> tab mặc định (khiếu nại)',
    (tab) => {
      expect(parseAdminRefundsPageQuery({ tab })).toMatchObject({ tab: 'disputes' });
    },
  );

  it.each([
    ['3', 3],
    ['0', 1],
    ['-1', 1],
    ['abc', 1],
    ['1.5', 1],
    ['', 1],
  ])('?page=%j -> %d', (page, expected) => {
    expect(parseAdminRefundsPageQuery({ page }).page).toBe(expected);
  });

  it('từng param sai rơi về mặc định ĐỘC LẬP: tab lạ không làm mất trang, trang sai không làm mất tab', () => {
    expect(parseAdminRefundsPageQuery({ tab: 'foo', page: '4' })).toMatchObject({
      tab: 'disputes',
      page: 4,
    });
    expect(parseAdminRefundsPageQuery({ tab: 'payments', page: 'x' })).toMatchObject({
      tab: 'payments',
      page: 1,
    });
  });

  it('param lặp (mảng) -> lấy giá trị đầu', () => {
    expect(
      parseAdminRefundsPageQuery({
        tab: ['failed', 'payments'],
        status: ['FAILED', 'PENDING'],
        page: ['2', '9'],
      }),
    ).toEqual({ tab: 'failed', status: 'FAILED', page: 2 });
  });
});

describe('cấu hình tab và bộ lọc', () => {
  it('ba tab theo thứ tự: khiếu nại (mặc định) → hoàn tiền lỗi → thanh toán cần hoàn', () => {
    expect([...ADMIN_REFUND_TABS]).toEqual(['disputes', 'failed', 'payments']);
  });

  it('bộ lọc của tab hoàn tiền lỗi = đúng 4 giá trị BE nhận (không thiếu, không thừa)', () => {
    expect([...ADMIN_LEDGER_FILTERS].sort()).toEqual(
      [...adminRefundListFilterSchema.options].sort(),
    );
  });

  it('mọi bộ lọc của tab khiếu nại là giá trị BE nhận (status của hàng chờ nhận mọi trạng thái yêu cầu)', () => {
    for (const status of ADMIN_DISPUTE_FILTERS) {
      expect(adminRefundRequestListQuerySchema.safeParse({ status }).success, status).toBe(true);
    }
  });

  it.each([
    ['vi', vi.admin],
    ['en', en.admin],
  ] as const)('mọi tab và bộ lọc có nhãn (%s)', (_locale, messages) => {
    const dictionary = messages as Record<string, string>;
    for (const tab of ADMIN_REFUND_TABS)
      expect(dictionary[ADMIN_REFUND_TAB_LABEL_KEYS[tab]], tab).toBeTruthy();
    for (const f of ADMIN_DISPUTE_FILTERS)
      expect(dictionary[ADMIN_DISPUTE_FILTER_LABEL_KEYS[f]], f).toBeTruthy();
    for (const f of ADMIN_LEDGER_FILTERS)
      expect(dictionary[ADMIN_LEDGER_FILTER_LABEL_KEYS[f]], f).toBeTruthy();
  });
});

describe('buildAdminRefundsHref', () => {
  it('mặc định hết -> đường dẫn trần (trùng URL người dùng tự gõ)', () => {
    expect(buildAdminRefundsHref()).toBe('/admin/refunds');
    expect(buildAdminRefundsHref({ tab: 'disputes', status: 'ESCALATED', page: 1 })).toBe(
      '/admin/refunds',
    );
  });

  it('tab khác mặc định -> ?tab=; bộ lọc mặc định CỦA TAB ĐÓ bị bỏ', () => {
    expect(buildAdminRefundsHref({ tab: 'failed' })).toBe('/admin/refunds?tab=failed');
    expect(buildAdminRefundsHref({ tab: 'failed', status: 'NEEDS_ACTION' })).toBe(
      '/admin/refunds?tab=failed',
    );
    expect(buildAdminRefundsHref({ tab: 'payments' })).toBe('/admin/refunds?tab=payments');
  });

  it('bộ lọc khác mặc định -> có ?status=, kết hợp với tab và trang', () => {
    expect(buildAdminRefundsHref({ status: 'PENDING_SELLER' })).toBe(
      '/admin/refunds?status=PENDING_SELLER',
    );
    expect(buildAdminRefundsHref({ tab: 'failed', status: 'FAILED', page: 3 })).toBe(
      '/admin/refunds?tab=failed&status=FAILED&page=3',
    );
  });

  it('NEEDS_ACTION là mặc định của tab lỗi nhưng KHÔNG phải của tab khiếu nại -> ở tab khiếu nại vẫn ghi ra', () => {
    expect(buildAdminRefundsHref({ tab: 'disputes', status: 'NEEDS_ACTION' })).toContain(
      'status=NEEDS_ACTION',
    );
  });

  it('tab thanh toán bỏ qua status (không có bộ lọc con)', () => {
    expect(buildAdminRefundsHref({ tab: 'payments', status: 'FAILED', page: 2 })).toBe(
      '/admin/refunds?tab=payments&page=2',
    );
  });

  it('href dựng ra parse ngược lại đúng truy vấn (vòng tròn) với mọi tab × bộ lọc × trang', () => {
    const queries: AdminRefundsPageQuery[] = [
      ...ADMIN_DISPUTE_FILTERS.map((status) => ({ tab: 'disputes' as const, status, page: 2 })),
      ...ADMIN_LEDGER_FILTERS.map((status) => ({ tab: 'failed' as const, status, page: 3 })),
      { tab: 'payments', page: 4 },
    ];
    for (const query of queries) {
      const href = buildAdminRefundsHref(toAdminRefundsHrefInput(query));
      const params = Object.fromEntries(new URL(href, 'http://x').searchParams);

      expect(parseAdminRefundsPageQuery(params)).toEqual(query);
    }
  });
});

describe('buildAdminRefundsPagination', () => {
  const query: AdminRefundsPageQuery = { tab: 'failed', status: 'FAILED', page: 2 };

  it('tổng trang làm tròn lên, tối thiểu 1 kể cả khi rỗng', () => {
    expect(
      buildAdminRefundsPagination({ query: { ...query, page: 1 }, total: 0, limit: 20 }).totalPages,
    ).toBe(1);
    expect(buildAdminRefundsPagination({ query, total: 41, limit: 20 }).totalPages).toBe(3);
  });

  it('prev/next kế bên và GIỮ tab + bộ lọc', () => {
    expect(buildAdminRefundsPagination({ query, total: 60, limit: 20 })).toEqual({
      totalPages: 3,
      prevHref: '/admin/refunds?tab=failed&status=FAILED',
      nextHref: '/admin/refunds?tab=failed&status=FAILED&page=3',
    });
  });

  it('tab thanh toán: phân trang không kèm status', () => {
    expect(
      buildAdminRefundsPagination({ query: { tab: 'payments', page: 1 }, total: 45, limit: 20 }),
    ).toMatchObject({
      prevHref: '/admin/refunds?tab=payments',
      nextHref: '/admin/refunds?tab=payments&page=2',
    });
  });

  it('trang vượt quá trang cuối -> "Trước" nhảy về trang cuối thật, "Sau" giữ nguyên', () => {
    const pagination = buildAdminRefundsPagination({
      query: { ...query, page: 9 },
      total: 41,
      limit: 20,
    });

    expect(pagination.prevHref).toBe('/admin/refunds?tab=failed&status=FAILED&page=3');
    expect(pagination.nextHref).toBe('/admin/refunds?tab=failed&status=FAILED&page=3');
  });

  it('limit 0 không chia cho 0', () => {
    expect(buildAdminRefundsPagination({ query, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
