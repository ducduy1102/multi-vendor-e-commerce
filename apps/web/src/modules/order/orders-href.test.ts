import { describe, expect, it } from 'vitest';

import { buildOrdersHref, buildOrdersPagination } from './orders-href';

describe('buildOrdersHref', () => {
  it('không tab, trang 1 -> /orders trần (URL mặc định)', () => {
    expect(buildOrdersHref()).toBe('/orders');
    expect(buildOrdersHref({ page: 1 })).toBe('/orders');
  });

  it('có tab -> ?tab=', () => {
    expect(buildOrdersHref({ tab: 'awaiting-payment' })).toBe('/orders?tab=awaiting-payment');
  });

  it('trang > 1 -> ?page=, có thể kèm tab', () => {
    expect(buildOrdersHref({ page: 3 })).toBe('/orders?page=3');
    expect(buildOrdersHref({ tab: 'shipping', page: 2 })).toBe('/orders?tab=shipping&page=2');
  });
});

describe('buildOrdersPagination', () => {
  it('tính số trang từ total/limit (làm tròn lên)', () => {
    expect(buildOrdersPagination({ page: 1, total: 25, limit: 10 }).totalPages).toBe(3);
    expect(buildOrdersPagination({ page: 1, total: 20, limit: 10 }).totalPages).toBe(2);
  });

  it('không có đơn nào -> vẫn là 1 trang', () => {
    expect(buildOrdersPagination({ page: 1, total: 0, limit: 10 }).totalPages).toBe(1);
  });

  it('trang giữa: prev = page - 1, next = page + 1, giữ nguyên tab', () => {
    const result = buildOrdersPagination({ tab: 'pending', page: 2, total: 30, limit: 10 });

    expect(result.prevHref).toBe('/orders?tab=pending');
    expect(result.nextHref).toBe('/orders?tab=pending&page=3');
  });

  it('trang cuối: next không đi quá trang cuối; trang đầu: prev không xuống dưới 1', () => {
    expect(buildOrdersPagination({ page: 3, total: 30, limit: 10 }).nextHref).toBe(
      '/orders?page=3',
    );
    expect(buildOrdersPagination({ page: 1, total: 30, limit: 10 }).prevHref).toBe('/orders');
  });

  it('trang vượt quá trang cuối (gõ tay/đơn cuối vừa biến mất) -> prev nhảy về trang cuối thật', () => {
    const result = buildOrdersPagination({ page: 99, total: 30, limit: 10 });

    expect(result.totalPages).toBe(3);
    expect(result.prevHref).toBe('/orders?page=3');
    expect(result.nextHref).toBe('/orders?page=3');
  });

  it('limit 0/âm không gây chia cho 0', () => {
    expect(buildOrdersPagination({ page: 1, total: 5, limit: 0 }).totalPages).toBe(5);
  });
});
