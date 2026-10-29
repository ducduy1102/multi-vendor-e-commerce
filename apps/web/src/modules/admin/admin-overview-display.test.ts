import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { adminOverviewSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { parseAdminRefundsPageQuery } from './admin-refunds-href';
import {
  ADMIN_NAV_ITEMS,
  ADMIN_OVERVIEW_QUEUES,
  formatAdminNavCount,
  hasAnyAdminWork,
  isAdminNavItemActive,
} from './admin-overview-display';
import { parseAdminShopsPageQuery } from './admin-shops-page-query';
import type { AdminOverview } from './types';

const NONE: AdminOverview = {
  pendingShops: 0,
  escalatedRefundRequests: 0,
  refundsNeedingAction: 0,
  refundablePayments: 0,
};

const searchParamsOf = (href: string) =>
  Object.fromEntries(new URL(href, 'http://localhost').searchParams.entries());

describe('formatAdminNavCount', () => {
  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [128, '99+'],
  ])('%i -> %s', (count, text) => {
    expect(formatAdminNavCount(count)).toBe(text);
  });
});

describe('ADMIN_OVERVIEW_QUEUES', () => {
  it('có đúng một thẻ cho mỗi số của schema dùng chung, không thừa không thiếu', () => {
    const keys = ADMIN_OVERVIEW_QUEUES.map((queue) => queue.key).sort();

    expect(keys).toEqual(Object.keys(adminOverviewSchema.shape).sort());
  });

  it('thứ tự = độ gấp: khiếu nại, hoàn tiền lỗi, thanh toán cần hoàn, rồi shop chờ duyệt', () => {
    expect(ADMIN_OVERVIEW_QUEUES.map((queue) => queue.key)).toEqual([
      'escalatedRefundRequests',
      'refundsNeedingAction',
      'refundablePayments',
      'pendingShops',
    ]);
  });

  it('đích của từng thẻ khoá cứng đúng tab/bộ lọc BE đếm', () => {
    expect(
      Object.fromEntries(ADMIN_OVERVIEW_QUEUES.map((queue) => [queue.key, queue.href])),
    ).toEqual({
      escalatedRefundRequests: '/admin/refunds',
      refundsNeedingAction: '/admin/refunds?tab=failed',
      refundablePayments: '/admin/refunds?tab=payments',
      pendingShops: '/admin/shops',
    });
  });

  it('đích là route + bộ lọc THẬT SỰ được trang hỗ trợ: parse ngược ra đúng tab và đúng bộ lọc mặc định mà số đếm dùng', () => {
    const hrefOf = (key: keyof AdminOverview) =>
      ADMIN_OVERVIEW_QUEUES.find((queue) => queue.key === key)?.href ?? '';

    expect(parseAdminRefundsPageQuery(searchParamsOf(hrefOf('escalatedRefundRequests')))).toEqual({
      tab: 'disputes',
      status: 'ESCALATED',
      page: 1,
    });
    expect(parseAdminRefundsPageQuery(searchParamsOf(hrefOf('refundsNeedingAction')))).toEqual({
      tab: 'failed',
      status: 'NEEDS_ACTION',
      page: 1,
    });
    expect(parseAdminRefundsPageQuery(searchParamsOf(hrefOf('refundablePayments')))).toEqual({
      tab: 'payments',
      page: 1,
    });
    expect(parseAdminShopsPageQuery(searchParamsOf(hrefOf('pendingShops')))).toMatchObject({
      status: 'PENDING',
    });
  });

  it('mọi thẻ có khoá dịch tiêu đề và mô tả khác nhau', () => {
    const titles = ADMIN_OVERVIEW_QUEUES.map((queue) => queue.titleKey);
    const captions = ADMIN_OVERVIEW_QUEUES.map((queue) => queue.captionKey);

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(captions).size).toBe(captions.length);
  });
});

describe('hasAnyAdminWork', () => {
  it('tất cả bằng 0 -> false', () => {
    expect(hasAnyAdminWork(NONE)).toBe(false);
  });

  it.each(Object.keys(NONE) as (keyof AdminOverview)[])(
    'chỉ riêng %s > 0 vẫn là còn việc',
    (key) => {
      expect(hasAnyAdminWork({ ...NONE, [key]: 1 })).toBe(true);
    },
  );
});

describe('ADMIN_NAV_ITEMS', () => {
  it('chỉ trỏ tới trang ĐÃ CÓ trong app (không link tới trang chưa tồn tại)', () => {
    for (const item of ADMIN_NAV_ITEMS) {
      // vitest chạy từ thư mục apps/web (cwd), nơi có src/app.
      const page = resolve(process.cwd(), 'src/app/[locale]', `.${item.href}`, 'page.tsx');

      expect(existsSync(page), `${item.href} -> ${page}`).toBe(true);
    }
  });

  it('thứ tự: Tổng quan, Shop, Người dùng (ngay sau Shop), Hoàn tiền, Kháng nghị (cuối)', () => {
    expect(ADMIN_NAV_ITEMS.map((item) => item.href)).toEqual([
      '/admin',
      '/admin/shops',
      '/admin/users',
      '/admin/refunds',
      '/admin/appeals',
    ]);
  });

  it('số trên mục: Tổng quan không có số, Shop = shop chờ duyệt, Hoàn tiền = cộng ba hàng chờ hoàn tiền', () => {
    const overview: AdminOverview = {
      pendingShops: 5,
      escalatedRefundRequests: 2,
      refundsNeedingAction: 3,
      refundablePayments: 4,
    };
    const [home, shops, users, refunds, appeals] = ADMIN_NAV_ITEMS;

    expect(home.count(overview)).toBeNull();
    expect(shops.count(overview)).toBe(5);
    // Người dùng không có hàng chờ nên không có số trên nav.
    expect(users.count(overview)).toBeNull();
    expect(refunds.count(overview)).toBe(9);
    // Kháng nghị chưa có số trong /admin/overview nên không có số trên nav.
    expect(appeals.count(overview)).toBeNull();
  });
});

describe('isAdminNavItemActive', () => {
  const [home, shops] = ADMIN_NAV_ITEMS;

  it('"/admin" so khớp tuyệt đối: là tiền tố của mọi mục còn lại nên nếu không sẽ luôn sáng', () => {
    expect(isAdminNavItemActive(home, '/admin')).toBe(true);
    expect(isAdminNavItemActive(home, '/admin/shops')).toBe(false);
  });

  it('mục thường sáng ở chính nó và trang con, không sáng ở route chỉ trùng tiền tố chữ', () => {
    expect(isAdminNavItemActive(shops, '/admin/shops')).toBe(true);
    expect(isAdminNavItemActive(shops, '/admin/shops/abc')).toBe(true);
    expect(isAdminNavItemActive(shops, '/admin/shopsx')).toBe(false);
    expect(isAdminNavItemActive(shops, '/admin')).toBe(false);
  });
});
