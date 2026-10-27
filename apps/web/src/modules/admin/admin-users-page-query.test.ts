import { ADMIN_USER_LIST_MAX_PAGE, ADMIN_USER_SEARCH_MAX_LENGTH } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { isUserId, parseAdminUsersPageQuery } from './admin-users-page-query';

const ID = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';

describe('parseAdminUsersPageQuery', () => {
  it('không có param nào -> không lọc, trang 1, ngăn đóng', () => {
    expect(parseAdminUsersPageQuery({})).toEqual({
      status: undefined,
      role: undefined,
      q: undefined,
      page: 1,
      userId: undefined,
    });
  });

  it('đọc đủ các param hợp lệ', () => {
    expect(
      parseAdminUsersPageQuery({
        status: 'SUSPENDED',
        role: 'ADMIN',
        q: 'nguyen',
        page: '3',
        u: ID,
      }),
    ).toEqual({ status: 'SUSPENDED', role: 'ADMIN', q: 'nguyen', page: 3, userId: ID });
  });

  it('mỗi param sai dạng rơi về "không lọc" ĐỘC LẬP, không làm mất các param còn lại và không ném lỗi', () => {
    expect(
      parseAdminUsersPageQuery({
        status: 'DELETED',
        role: 'SELLER',
        q: 'an',
        page: '2',
        u: 'not-a-uuid',
      }),
    ).toEqual({ status: undefined, role: undefined, q: 'an', page: 2, userId: undefined });

    expect(
      parseAdminUsersPageQuery({ status: 'BANNED', role: 'USER', q: 'x'.repeat(300), page: 'abc' }),
    ).toMatchObject({ status: 'BANNED', role: 'USER', q: undefined, page: 1 });
  });

  it('trang không hợp lệ (0, âm, thập phân, vượt trần) rơi về 1', () => {
    for (const page of ['0', '-1', '1.5', 'NaN', String(ADMIN_USER_LIST_MAX_PAGE + 1), '1e21']) {
      expect(parseAdminUsersPageQuery({ page }).page, page).toBe(1);
    }
    expect(parseAdminUsersPageQuery({ page: String(ADMIN_USER_LIST_MAX_PAGE) }).page).toBe(
      ADMIN_USER_LIST_MAX_PAGE,
    );
  });

  it('từ khoá: cắt khoảng trắng hai đầu; rỗng/toàn khoảng trắng coi như không tìm', () => {
    expect(parseAdminUsersPageQuery({ q: '  an  ' }).q).toBe('an');
    expect(parseAdminUsersPageQuery({ q: '' }).q).toBeUndefined();
    expect(parseAdminUsersPageQuery({ q: '   ' }).q).toBeUndefined();
  });

  it('từ khoá dài đúng giới hạn vẫn nhận, vượt 1 ký tự thì bỏ', () => {
    expect(
      parseAdminUsersPageQuery({ q: 'a'.repeat(ADMIN_USER_SEARCH_MAX_LENGTH) }).q,
    ).toHaveLength(ADMIN_USER_SEARCH_MAX_LENGTH);
    expect(
      parseAdminUsersPageQuery({ q: 'a'.repeat(ADMIN_USER_SEARCH_MAX_LENGTH + 1) }).q,
    ).toBeUndefined();
  });

  it('từ khoá chứa ký tự điều khiển (NUL, xuống dòng) bị bỏ — BE sẽ từ chối, không gửi đi', () => {
    expect(parseAdminUsersPageQuery({ q: 'a\u0000b' }).q).toBeUndefined();
    expect(parseAdminUsersPageQuery({ q: 'a\nb' }).q).toBeUndefined();
  });

  it('param lặp (?status=a&status=b) chỉ lấy giá trị đầu', () => {
    expect(
      parseAdminUsersPageQuery({ status: ['BANNED', 'ACTIVE'], page: ['4', '9'] }),
    ).toMatchObject({
      status: 'BANNED',
      page: 4,
    });
  });

  it('id người dùng chỉ nhận UUID (không bao giờ đưa chuỗi tuỳ ý vào URL gọi API)', () => {
    expect(parseAdminUsersPageQuery({ u: ID.toUpperCase() }).userId).toBe(ID.toUpperCase());
    for (const u of [
      '',
      '123',
      '../../etc/passwd',
      `${ID}/x`,
      `${ID} `,
      "'; DROP TABLE users;--",
    ]) {
      expect(parseAdminUsersPageQuery({ u }).userId, u).toBeUndefined();
    }
  });
});

describe('isUserId', () => {
  it('khớp UUID, từ chối mọi thứ khác', () => {
    expect(isUserId(ID)).toBe(true);
    expect(isUserId('x')).toBe(false);
    expect(isUserId(`${ID}\n`)).toBe(false);
  });
});
