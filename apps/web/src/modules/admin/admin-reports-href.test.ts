import { describe, expect, it } from 'vitest';

import { parseAdminReportsPageQuery } from './admin-reports-page-query';
import {
  ADMIN_REPORTS_PATH,
  buildAdminReportDetailHref,
  buildAdminReportsHref,
  buildAdminReportsPagination,
} from './admin-reports-href';

const searchParamsOf = (href: string) =>
  Object.fromEntries(new URL(href, 'http://localhost').searchParams.entries());

describe('buildAdminReportsHref', () => {
  it('mặc định (tab chờ xử lý, mọi loại, trang 1) ⇒ URL trần, đúng một dạng', () => {
    expect(buildAdminReportsHref()).toBe(ADMIN_REPORTS_PATH);
    expect(buildAdminReportsHref({ status: 'OPEN', page: 1 })).toBe('/admin/reports');
  });

  it('chỉ ghi tham số KHÁC mặc định', () => {
    expect(buildAdminReportsHref({ status: 'CLOSED' })).toBe('/admin/reports?status=CLOSED');
    expect(buildAdminReportsHref({ targetType: 'SHOP' })).toBe('/admin/reports?type=SHOP');
    expect(buildAdminReportsHref({ page: 3 })).toBe('/admin/reports?page=3');
    expect(buildAdminReportsHref({ status: 'CLOSED', targetType: 'REVIEW', page: 2 })).toBe(
      '/admin/reports?status=CLOSED&type=REVIEW&page=2',
    );
  });

  it('URL dựng ra đọc ngược được về đúng bộ lọc (vòng khứ hồi với parseAdminReportsPageQuery)', () => {
    const href = buildAdminReportsHref({ status: 'CLOSED', targetType: 'PRODUCT', page: 4 });

    expect(parseAdminReportsPageQuery(searchParamsOf(href))).toEqual({
      status: 'CLOSED',
      targetType: 'PRODUCT',
      page: 4,
    });
  });
});

describe('buildAdminReportDetailHref', () => {
  it('id đi vào đường dẫn được mã hoá (không chèn được đoạn đường dẫn khác)', () => {
    expect(buildAdminReportDetailHref('abc')).toBe('/admin/reports/abc');
    expect(buildAdminReportDetailHref('a/b?x=1')).toBe('/admin/reports/a%2Fb%3Fx%3D1');
  });
});

describe('buildAdminReportsPagination', () => {
  it('giữ nguyên tab và loại khi sang trang trước / sau', () => {
    const pagination = buildAdminReportsPagination({
      status: 'CLOSED',
      targetType: 'SHOP',
      page: 2,
      total: 95,
      limit: 20,
    });

    expect(pagination.totalPages).toBe(5);
    expect(pagination.prevHref).toBe('/admin/reports?status=CLOSED&type=SHOP');
    expect(pagination.nextHref).toBe('/admin/reports?status=CLOSED&type=SHOP&page=3');
  });

  it('kẹp trong [1, tổng trang]: trang đầu không lùi, trang cuối không tiến, URL gõ tay vượt trang cuối vẫn có đường về', () => {
    expect(buildAdminReportsPagination({ page: 1, total: 50, limit: 20 }).prevHref).toBe(
      '/admin/reports',
    );
    expect(buildAdminReportsPagination({ page: 3, total: 50, limit: 20 }).nextHref).toBe(
      '/admin/reports?page=3',
    );
    expect(buildAdminReportsPagination({ page: 99, total: 50, limit: 20 }).prevHref).toBe(
      '/admin/reports?page=3',
    );
  });

  it('không có báo cáo nào ⇒ vẫn 1 trang (không chia cho 0)', () => {
    expect(buildAdminReportsPagination({ page: 1, total: 0, limit: 20 }).totalPages).toBe(1);
    expect(buildAdminReportsPagination({ page: 1, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
