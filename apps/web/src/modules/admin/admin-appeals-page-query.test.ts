import { LIST_MAX_PAGE } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { parseAdminAppealsPageQuery } from './admin-appeals-page-query';

describe('parseAdminAppealsPageQuery', () => {
  it('không có param → mặc định (hàng chờ xử lý, trang 1)', () => {
    expect(parseAdminAppealsPageQuery({})).toEqual({ status: 'PENDING', page: 1 });
  });

  it('đọc status và page hợp lệ (page là chuỗi từ URL)', () => {
    expect(parseAdminAppealsPageQuery({ status: 'CLOSED', page: '4' })).toEqual({
      status: 'CLOSED',
      page: 4,
    });
  });

  it.each(['pending', 'ALL', '', 'DROP TABLE', '<script>'])(
    'status sai dạng (%j) → về PENDING, không ném lỗi',
    (status) => {
      expect(parseAdminAppealsPageQuery({ status }).status).toBe('PENDING');
    },
  );

  it.each(['0', '-1', 'abc', '1e21', '1.5', String(LIST_MAX_PAGE + 1)])(
    'page sai dạng (%j) → về 1',
    (page) => {
      expect(parseAdminAppealsPageQuery({ page }).page).toBe(1);
    },
  );

  it('hai param độc lập: status lạ không làm mất trang đang xem, và ngược lại', () => {
    expect(parseAdminAppealsPageQuery({ status: 'bad', page: '3' })).toEqual({
      status: 'PENDING',
      page: 3,
    });
    expect(parseAdminAppealsPageQuery({ status: 'REJECTED', page: 'bad' })).toEqual({
      status: 'REJECTED',
      page: 1,
    });
  });

  it('param lặp (mảng) → chỉ lấy giá trị đầu', () => {
    expect(
      parseAdminAppealsPageQuery({ status: ['ACCEPTED', 'CLOSED'], page: ['2', '9'] }),
    ).toEqual({
      status: 'ACCEPTED',
      page: 2,
    });
  });

  it('page đúng trần LIST_MAX_PAGE vẫn hợp lệ', () => {
    expect(parseAdminAppealsPageQuery({ page: String(LIST_MAX_PAGE) }).page).toBe(LIST_MAX_PAGE);
  });
});
