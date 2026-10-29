import { SHOP_STATUS_TRANSITIONS, shopStatusSchema, shopTransitionTargets } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_SHOP_ACTION_TARGET,
  getAdminShopActions,
  shouldStackShopActions,
  type AdminShopAction,
} from './admin-shop-actions';
import type { ShopStatus } from './types';

describe('getAdminShopActions', () => {
  it.each<[string, AdminShopAction[]]>([
    ['PENDING', ['approve', 'reject']],
    ['APPROVED', ['suspend']],
    ['SUSPENDED', ['unsuspend']],
    ['REJECTED', []],
  ])('shop %s -> nút %j', (status, expected) => {
    expect(getAdminShopActions(status as Parameters<typeof getAdminShopActions>[0])).toEqual(
      expected,
    );
  });

  // Lưới an toàn khi bảng chuyển trạng thái dùng chung đổi: thêm cạnh ADMIN mới ở packages/types mà FE
  // chưa có nút tương ứng thì test này đỏ, thay vì admin lặng lẽ không có cách thực hiện cạnh đó.
  it.each(shopStatusSchema.options)(
    'shop %s: tập trạng thái đích của các nút = đúng tập đích ADMIN trong SHOP_STATUS_TRANSITIONS',
    (status) => {
      const targets = getAdminShopActions(status).map((action) => ADMIN_SHOP_ACTION_TARGET[action]);

      expect([...targets].sort()).toEqual([...shopTransitionTargets('ADMIN', status)].sort());
    },
  );

  it('cạnh của OWNER (REJECTED → PENDING) KHÔNG thành nút của Admin dù bảng chung có cạnh đó', () => {
    expect(
      SHOP_STATUS_TRANSITIONS.some(
        (edge) => edge.from === 'REJECTED' && edge.to === 'PENDING' && edge.actor === 'OWNER',
      ),
    ).toBe(true);
    expect(getAdminShopActions('REJECTED')).toEqual([]);
  });

  it('"Duyệt" và "Mở khoá" cùng đích APPROVED nhưng không bao giờ cùng xuất hiện trên 1 shop', () => {
    expect(ADMIN_SHOP_ACTION_TARGET.approve).toBe('APPROVED');
    expect(ADMIN_SHOP_ACTION_TARGET.unsuspend).toBe('APPROVED');
    for (const status of shopStatusSchema.options) {
      const actions = getAdminShopActions(status);
      expect(actions.includes('approve') && actions.includes('unsuspend')).toBe(false);
    }
  });

  it('không hành động nào đưa shop về PENDING (đích chỉ APPROVED/REJECTED/SUSPENDED)', () => {
    expect(Object.values(ADMIN_SHOP_ACTION_TARGET)).not.toContain('PENDING');
  });
});

describe('shouldStackShopActions (Week11.md 4.5)', () => {
  it.each([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
    [4, true],
  ])('%i nút ⇒ xếp dọc: %s', (count, expected) => {
    expect(shouldStackShopActions(count)).toBe(expected);
  });

  it('ngưỡng là 3: đúng số nút của tab Chờ duyệt / Đã khoá (có Ghi chú) và ít hơn ở Đã duyệt / Đã từ chối', () => {
    const withNotes = (status: ShopStatus) => getAdminShopActions(status).length + 1;
    const withCancelOrders = getAdminShopActions('SUSPENDED').length + 1 + 1;

    expect(shouldStackShopActions(withNotes('PENDING'))).toBe(true);
    expect(shouldStackShopActions(withCancelOrders)).toBe(true);
    expect(shouldStackShopActions(withNotes('APPROVED'))).toBe(false);
    expect(shouldStackShopActions(withNotes('REJECTED'))).toBe(false);
  });
});
