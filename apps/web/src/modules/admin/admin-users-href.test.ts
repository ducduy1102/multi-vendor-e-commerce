import { describe, expect, it } from 'vitest';

import { buildAdminUsersHref, buildAdminUsersPagination } from './admin-users-href';
import { parseAdminUsersPageQuery } from './admin-users-page-query';

const ID = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';

describe('buildAdminUsersHref', () => {
  it('không có gì -> /admin/users trơn (bỏ mọi giá trị mặc định)', () => {
    expect(buildAdminUsersHref()).toBe('/admin/users');
    expect(buildAdminUsersHref({ page: 1 })).toBe('/admin/users');
    expect(buildAdminUsersHref({ q: '' })).toBe('/admin/users');
  });

  it('đủ param, theo thứ tự cố định status, role, q, page, u', () => {
    expect(
      buildAdminUsersHref({ status: 'BANNED', role: 'USER', q: 'an', page: 2, userId: ID }),
    ).toBe(`/admin/users?status=BANNED&role=USER&q=an&page=2&u=${ID}`);
  });

  it('mã hoá từ khoá có ký tự đặc biệt / tiếng Việt, và đọc lại đúng nguyên văn', () => {
    const q = 'Nguyễn Văn & Co=?#';
    const href = buildAdminUsersHref({ q });
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams);

    expect(href).not.toContain('&Co');
    expect(parseAdminUsersPageQuery(params).q).toBe(q);
  });

  it('chu trình: dựng URL rồi đọc lại ra đúng bộ lọc ban đầu', () => {
    const query = { status: 'SUSPENDED', role: 'ADMIN', q: 'a b', page: 5, userId: ID } as const;
    const params = Object.fromEntries(new URL(buildAdminUsersHref(query), 'http://x').searchParams);

    expect(parseAdminUsersPageQuery(params)).toEqual(query);
  });
});

describe('buildAdminUsersPagination', () => {
  const base = { status: 'ACTIVE', role: 'USER', q: 'an', limit: 20 } as const;

  it('giữ nguyên bộ lọc, đổi trang, và KHÔNG mang theo ngăn chi tiết đang mở', () => {
    const result = buildAdminUsersPagination({ ...base, page: 2, total: 100 });

    expect(result.totalPages).toBe(5);
    expect(result.prevHref).toBe('/admin/users?status=ACTIVE&role=USER&q=an');
    expect(result.nextHref).toBe('/admin/users?status=ACTIVE&role=USER&q=an&page=3');
    expect(result.prevHref).not.toContain('u=');
    expect(result.nextHref).not.toContain('u=');
  });

  it('danh sách rỗng vẫn là trang 1/1', () => {
    expect(buildAdminUsersPagination({ page: 1, total: 0, limit: 20 })).toEqual({
      totalPages: 1,
      prevHref: '/admin/users',
      nextHref: '/admin/users',
    });
  });

  it('trang vượt quá trang cuối: "Trước" nhảy thẳng về trang cuối thật, "Sau" giữ nguyên trang đang xem', () => {
    const result = buildAdminUsersPagination({ page: 99, total: 45, limit: 20 });

    expect(result.totalPages).toBe(3);
    expect(result.prevHref).toBe('/admin/users?page=3');
    expect(result.nextHref).toBe('/admin/users?page=3');
  });

  it('limit 0 hoặc âm không chia cho 0', () => {
    expect(buildAdminUsersPagination({ page: 1, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
