import { describe, expect, it } from 'vitest';

import { parseAdminShopsPageQuery } from './admin-shops-page-query';

describe('parseAdminShopsPageQuery', () => {
  it('không có param -> hàng chờ duyệt, trang 1 (giống mặc định của BE)', () => {
    expect(parseAdminShopsPageQuery({})).toEqual({ status: 'PENDING', page: 1 });
  });

  it.each(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const)(
    'status=%s hợp lệ -> giữ nguyên',
    (status) => {
      expect(parseAdminShopsPageQuery({ status }).status).toBe(status);
    },
  );

  it('page hợp lệ là chuỗi số -> đổi thành number', () => {
    expect(parseAdminShopsPageQuery({ page: '3' }).page).toBe(3);
  });

  it('status lạ không làm mất trang đang xem, và page sai không làm mất tab (rơi về mặc định ĐỘC LẬP)', () => {
    expect(parseAdminShopsPageQuery({ status: 'bogus', page: '4' })).toEqual({
      status: 'PENDING',
      page: 4,
    });
    expect(parseAdminShopsPageQuery({ status: 'APPROVED', page: 'abc' })).toEqual({
      status: 'APPROVED',
      page: 1,
    });
  });

  it.each(['0', '-1', '1.5', ''])('page=%p không hợp lệ -> trang 1', (page) => {
    expect(parseAdminShopsPageQuery({ page }).page).toBe(1);
  });

  it('chữ thường không phải enum (?status=approved) -> mặc định, không đoán', () => {
    expect(parseAdminShopsPageQuery({ status: 'approved' }).status).toBe('PENDING');
  });

  it('param lặp (mảng) -> chỉ lấy giá trị đầu', () => {
    expect(
      parseAdminShopsPageQuery({ status: ['SUSPENDED', 'APPROVED'], page: ['2', '5'] }),
    ).toEqual({ status: 'SUSPENDED', page: 2 });
  });

  it('không bao giờ ném lỗi dù URL tuỳ ý', () => {
    expect(() =>
      parseAdminShopsPageQuery({ status: ['', ''], page: [], extra: 'x' } as never),
    ).not.toThrow();
  });
});
