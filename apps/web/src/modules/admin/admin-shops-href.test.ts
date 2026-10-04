import { describe, expect, it } from 'vitest';

import {
  ADMIN_SHOPS_PATH,
  buildAdminShopsHref,
  buildAdminShopsPagination,
} from './admin-shops-href';

describe('buildAdminShopsHref', () => {
  it('không tham số -> trang gốc (hàng chờ duyệt, trang 1)', () => {
    expect(buildAdminShopsHref()).toBe(ADMIN_SHOPS_PATH);
  });

  it('PENDING là mặc định của BE -> không có ?status= (link gọn, trùng URL người dùng tự gõ)', () => {
    expect(buildAdminShopsHref({ status: 'PENDING' })).toBe('/admin/shops');
  });

  it.each(['APPROVED', 'REJECTED', 'SUSPENDED'] as const)('%s -> ?status=%s', (status) => {
    expect(buildAdminShopsHref({ status })).toBe(`/admin/shops?status=${status}`);
  });

  it('trang 1 bị bỏ, trang ≥ 2 có ?page=', () => {
    expect(buildAdminShopsHref({ status: 'APPROVED', page: 1 })).toBe(
      '/admin/shops?status=APPROVED',
    );
    expect(buildAdminShopsHref({ status: 'APPROVED', page: 3 })).toBe(
      '/admin/shops?status=APPROVED&page=3',
    );
    expect(buildAdminShopsHref({ page: 2 })).toBe('/admin/shops?page=2');
  });
});

describe('buildAdminShopsPagination', () => {
  it('chia trang theo total/limit, tối thiểu 1 trang kể cả khi rỗng', () => {
    expect(buildAdminShopsPagination({ page: 1, total: 0, limit: 20 }).totalPages).toBe(1);
    expect(buildAdminShopsPagination({ page: 1, total: 20, limit: 20 }).totalPages).toBe(1);
    expect(buildAdminShopsPagination({ page: 1, total: 21, limit: 20 }).totalPages).toBe(2);
  });

  it('giữ nguyên tab khi sang trang trước/sau', () => {
    const result = buildAdminShopsPagination({
      status: 'SUSPENDED',
      page: 2,
      total: 100,
      limit: 20,
    });

    expect(result.prevHref).toBe('/admin/shops?status=SUSPENDED');
    expect(result.nextHref).toBe('/admin/shops?status=SUSPENDED&page=3');
  });

  it('trang cuối: "Trang sau" ở nguyên trang hiện tại, không vượt tổng số trang', () => {
    const result = buildAdminShopsPagination({ page: 3, total: 41, limit: 20 });

    expect(result.nextHref).toBe('/admin/shops?page=3');
  });

  it('trang vượt quá trang cuối (gõ tay, hoặc duyệt hết shop của trang cuối) -> "Trang trước" nhảy về trang cuối thật', () => {
    const result = buildAdminShopsPagination({ page: 9, total: 41, limit: 20 });

    expect(result.totalPages).toBe(3);
    expect(result.prevHref).toBe('/admin/shops?page=3');
  });

  it('limit 0 không gây chia cho 0', () => {
    expect(buildAdminShopsPagination({ page: 1, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
