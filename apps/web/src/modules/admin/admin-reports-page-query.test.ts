import { describe, expect, it } from 'vitest';

import { parseAdminReportId, parseAdminReportsPageQuery } from './admin-reports-page-query';

describe('parseAdminReportsPageQuery', () => {
  it('không có tham số ⇒ tab chờ xử lý, mọi loại, trang 1', () => {
    expect(parseAdminReportsPageQuery({})).toEqual({
      status: 'OPEN',
      targetType: undefined,
      page: 1,
    });
  });

  it('đọc đúng status, type và page hợp lệ', () => {
    expect(parseAdminReportsPageQuery({ status: 'CLOSED', type: 'SHOP', page: '3' })).toEqual({
      status: 'CLOSED',
      targetType: 'SHOP',
      page: 3,
    });
  });

  it.each([
    ['status lạ', { status: 'ALL' }],
    ['status viết thường', { status: 'closed' }],
    ['type lạ', { type: 'USER' }],
    ['type viết thường', { type: 'shop' }],
    ['page = 0', { page: '0' }],
    ['page âm', { page: '-2' }],
    ['page chữ', { page: 'abc' }],
    ['page thập phân', { page: '1.5' }],
    ['page vượt trần', { page: '99999999' }],
  ])('%s ⇒ rơi về mặc định, không làm sập trang', (_name, raw) => {
    expect(parseAdminReportsPageQuery(raw)).toEqual({
      status: 'OPEN',
      targetType: undefined,
      page: 1,
    });
  });

  it('tham số lặp (?type=a&type=b) chỉ lấy giá trị đầu', () => {
    expect(
      parseAdminReportsPageQuery({ type: ['REVIEW', 'SHOP'], status: ['CLOSED', 'OPEN'] }),
    ).toEqual({
      status: 'CLOSED',
      targetType: 'REVIEW',
      page: 1,
    });
  });

  it('một tham số sai không làm hỏng các tham số đúng còn lại', () => {
    expect(parseAdminReportsPageQuery({ status: 'CLOSED', type: 'XXX', page: '2' })).toEqual({
      status: 'CLOSED',
      targetType: undefined,
      page: 2,
    });
  });
});

describe('parseAdminReportId', () => {
  it('UUID hợp lệ đi tiếp', () => {
    expect(parseAdminReportId('a1b2c3d4-1234-4a5b-8c9d-abcdef000001')).toBe(
      'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
    );
  });

  it.each([
    '',
    'abc',
    '123',
    '../../etc/passwd',
    'a1b2c3d4-1234-4a5b-8c9d-abcdef00000',
    `a${String.fromCharCode(0)}b`,
  ])('id sai dạng %j ⇒ null (page trả 404, không gọi API)', (raw) => {
    expect(parseAdminReportId(raw)).toBeNull();
  });
});
