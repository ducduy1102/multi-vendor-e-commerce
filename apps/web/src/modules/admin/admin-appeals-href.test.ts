import { describe, expect, it } from 'vitest';

import { buildAdminAppealsHref, buildAdminAppealsPagination } from './admin-appeals-href';

describe('buildAdminAppealsHref', () => {
  it('bỏ param mặc định (PENDING, trang 1) để link gọn', () => {
    expect(buildAdminAppealsHref()).toBe('/admin/appeals');
    expect(buildAdminAppealsHref({ status: 'PENDING' })).toBe('/admin/appeals');
    expect(buildAdminAppealsHref({ status: 'PENDING', page: 1 })).toBe('/admin/appeals');
  });

  it('giữ status khác mặc định và trang > 1', () => {
    expect(buildAdminAppealsHref({ status: 'CLOSED' })).toBe('/admin/appeals?status=CLOSED');
    expect(buildAdminAppealsHref({ page: 3 })).toBe('/admin/appeals?page=3');
    expect(buildAdminAppealsHref({ status: 'REJECTED', page: 2 })).toBe(
      '/admin/appeals?status=REJECTED&page=2',
    );
  });
});

describe('buildAdminAppealsPagination', () => {
  it('tổng trang làm tròn lên, tối thiểu 1 (danh sách rỗng vẫn là trang 1/1)', () => {
    expect(buildAdminAppealsPagination({ page: 1, total: 41, limit: 20 }).totalPages).toBe(3);
    expect(buildAdminAppealsPagination({ page: 1, total: 0, limit: 20 }).totalPages).toBe(1);
    expect(buildAdminAppealsPagination({ page: 1, total: 20, limit: 20 }).totalPages).toBe(1);
  });

  it('trang giữa: trước/sau cạnh nhau và giữ nguyên tab', () => {
    const result = buildAdminAppealsPagination({
      status: 'ACCEPTED',
      page: 2,
      total: 50,
      limit: 20,
    });

    expect(result.prevHref).toBe('/admin/appeals?status=ACCEPTED');
    expect(result.nextHref).toBe('/admin/appeals?status=ACCEPTED&page=3');
  });

  it('trang đầu: "trước" ở lại trang 1; trang cuối: "sau" ở lại trang cuối', () => {
    expect(buildAdminAppealsPagination({ page: 1, total: 50, limit: 20 }).prevHref).toBe(
      '/admin/appeals',
    );
    expect(buildAdminAppealsPagination({ page: 3, total: 50, limit: 20 }).nextHref).toBe(
      '/admin/appeals?page=3',
    );
  });

  it('trang vượt quá trang cuối (gõ tay URL): "trước" nhảy thẳng về trang cuối thật, không về page - 1 vẫn rỗng', () => {
    const result = buildAdminAppealsPagination({ page: 99, total: 50, limit: 20 });

    expect(result.prevHref).toBe('/admin/appeals?page=3');
    expect(result.nextHref).toBe('/admin/appeals?page=3');
  });

  it('limit bằng 0 không gây chia cho 0', () => {
    expect(buildAdminAppealsPagination({ page: 1, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
