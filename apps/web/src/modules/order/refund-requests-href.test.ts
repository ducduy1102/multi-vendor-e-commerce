import { sellerRefundRequestListQuerySchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  DEFAULT_SELLER_REFUND_REQUEST_FILTER,
  SELLER_REFUND_REQUEST_FILTERS,
  SELLER_REFUND_REQUEST_FILTER_LABEL_KEYS,
  buildSellerRefundRequestsHref,
  buildSellerRefundRequestsPagination,
  parseSellerRefundRequestsPageQuery,
  toRefundRequestStatusParam,
} from './refund-requests-href';

describe('parseSellerRefundRequestsPageQuery', () => {
  it('không có param -> tab mặc định "Chờ bạn phản hồi", trang 1', () => {
    expect(parseSellerRefundRequestsPageQuery({})).toEqual({
      filter: 'PENDING_SELLER',
      page: 1,
    });
    expect(DEFAULT_SELLER_REFUND_REQUEST_FILTER).toBe('PENDING_SELLER');
  });

  it.each(['ESCALATED', 'APPROVED', 'REJECTED_BY_SELLER', 'REJECTED', 'PENDING_SELLER'])(
    '?status=%s -> đúng bộ lọc đó',
    (status) => {
      expect(parseSellerRefundRequestsPageQuery({ status }).filter).toBe(status);
    },
  );

  it('?status=all -> "Tất cả" (khác tab mặc định, phải gõ rõ)', () => {
    expect(parseSellerRefundRequestsPageQuery({ status: 'all' }).filter).toBe('all');
  });

  it.each(['WITHDRAWN', 'withdrawn', 'pending_seller', 'foo', '', '1', 'toString'])(
    '?status=%j không hợp lệ (BE từ chối) -> rơi về tab mặc định, KHÔNG gửi lên API',
    (status) => {
      expect(parseSellerRefundRequestsPageQuery({ status }).filter).toBe('PENDING_SELLER');
    },
  );

  it.each([
    ['2', 2],
    ['abc', 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    ['', 1],
  ])('?page=%j -> %d', (page, expected) => {
    expect(parseSellerRefundRequestsPageQuery({ page }).page).toBe(expected);
  });

  it('status sai không làm mất trang đang xem và ngược lại (rơi về mặc định ĐỘC LẬP)', () => {
    expect(parseSellerRefundRequestsPageQuery({ status: 'foo', page: '3' })).toEqual({
      filter: 'PENDING_SELLER',
      page: 3,
    });
    expect(parseSellerRefundRequestsPageQuery({ status: 'APPROVED', page: 'x' })).toEqual({
      filter: 'APPROVED',
      page: 1,
    });
  });

  it('param lặp (mảng) -> lấy giá trị đầu', () => {
    expect(
      parseSellerRefundRequestsPageQuery({ status: ['ESCALATED', 'APPROVED'], page: ['2', '5'] }),
    ).toEqual({ filter: 'ESCALATED', page: 2 });
  });
});

describe('toRefundRequestStatusParam', () => {
  it('"Tất cả" -> không gửi status (BE trả mọi yêu cầu chưa rút)', () => {
    expect(toRefundRequestStatusParam('all')).toBeUndefined();
  });

  it('trạng thái cụ thể -> gửi đúng trạng thái', () => {
    expect(toRefundRequestStatusParam('ESCALATED')).toBe('ESCALATED');
  });

  it('mọi trạng thái FE gửi đi đều là giá trị schema BE chấp nhận', () => {
    for (const filter of SELLER_REFUND_REQUEST_FILTERS) {
      const parsed = sellerRefundRequestListQuerySchema.safeParse({
        status: toRefundRequestStatusParam(filter),
      });
      expect(parsed.success, filter).toBe(true);
    }
  });
});

describe('SELLER_REFUND_REQUEST_FILTERS', () => {
  it('phủ đúng mọi trạng thái BE lọc được + "Tất cả" (không thiếu, không thừa, không có WITHDRAWN)', () => {
    const statuses = sellerRefundRequestListQuerySchema.shape.status.unwrap().options;

    expect([...SELLER_REFUND_REQUEST_FILTERS].sort()).toEqual([...statuses, 'all'].sort());
    expect(SELLER_REFUND_REQUEST_FILTERS).not.toContain('WITHDRAWN');
  });

  it('việc cần làm đứng đầu, "Tất cả" đứng cuối', () => {
    expect(SELLER_REFUND_REQUEST_FILTERS[0]).toBe('PENDING_SELLER');
    expect(SELLER_REFUND_REQUEST_FILTERS.at(-1)).toBe('all');
  });

  it.each([
    ['vi', vi.order],
    ['en', en.order],
  ] as const)('mọi tab có nhãn (%s)', (_locale, messages) => {
    for (const filter of SELLER_REFUND_REQUEST_FILTERS) {
      expect(
        (messages as Record<string, string>)[SELLER_REFUND_REQUEST_FILTER_LABEL_KEYS[filter]],
        filter,
      ).toBeTruthy();
    }
  });
});

describe('buildSellerRefundRequestsHref', () => {
  it('tab mặc định + trang 1 -> đường dẫn trần (trùng URL người dùng tự gõ)', () => {
    expect(buildSellerRefundRequestsHref()).toBe('/seller/refund-requests');
    expect(buildSellerRefundRequestsHref({ filter: 'PENDING_SELLER', page: 1 })).toBe(
      '/seller/refund-requests',
    );
  });

  it('tab khác mặc định -> có ?status=', () => {
    expect(buildSellerRefundRequestsHref({ filter: 'ESCALATED' })).toBe(
      '/seller/refund-requests?status=ESCALATED',
    );
  });

  it('"Tất cả" phải ghi rõ ?status=all (vì không param = tab mặc định)', () => {
    expect(buildSellerRefundRequestsHref({ filter: 'all' })).toBe(
      '/seller/refund-requests?status=all',
    );
  });

  it('trang > 1 -> có ?page=, kết hợp với tab', () => {
    expect(buildSellerRefundRequestsHref({ filter: 'APPROVED', page: 3 })).toBe(
      '/seller/refund-requests?status=APPROVED&page=3',
    );
    expect(buildSellerRefundRequestsHref({ page: 2 })).toBe('/seller/refund-requests?page=2');
  });

  it('href dựng ra parse ngược lại đúng bộ lọc (vòng tròn)', () => {
    for (const filter of SELLER_REFUND_REQUEST_FILTERS) {
      const href = buildSellerRefundRequestsHref({ filter, page: 2 });
      const params = Object.fromEntries(new URL(href, 'http://x').searchParams);

      expect(parseSellerRefundRequestsPageQuery(params)).toEqual({ filter, page: 2 });
    }
  });
});

describe('buildSellerRefundRequestsPagination', () => {
  it('tổng trang làm tròn lên, tối thiểu 1 kể cả khi rỗng', () => {
    expect(
      buildSellerRefundRequestsPagination({ filter: 'all', page: 1, total: 0, limit: 20 })
        .totalPages,
    ).toBe(1);
    expect(
      buildSellerRefundRequestsPagination({ filter: 'all', page: 1, total: 41, limit: 20 })
        .totalPages,
    ).toBe(3);
  });

  it('trang giữa -> prev/next kế bên, giữ nguyên bộ lọc', () => {
    expect(
      buildSellerRefundRequestsPagination({ filter: 'APPROVED', page: 2, total: 60, limit: 20 }),
    ).toEqual({
      totalPages: 3,
      prevHref: '/seller/refund-requests?status=APPROVED',
      nextHref: '/seller/refund-requests?status=APPROVED&page=3',
    });
  });

  it('trang vượt quá trang cuối (xử lý hết yêu cầu cuối của trang cuối) -> "Trước" nhảy về trang cuối thật, "Sau" giữ nguyên', () => {
    const pagination = buildSellerRefundRequestsPagination({
      filter: 'all',
      page: 9,
      total: 41,
      limit: 20,
    });

    expect(pagination.prevHref).toBe('/seller/refund-requests?status=all&page=3');
    expect(pagination.nextHref).toBe('/seller/refund-requests?status=all&page=3');
  });

  it('limit 0 không chia cho 0', () => {
    expect(
      buildSellerRefundRequestsPagination({ filter: 'all', page: 1, total: 5, limit: 0 })
        .totalPages,
    ).toBe(5);
  });
});
