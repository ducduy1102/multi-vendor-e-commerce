import { SHOP_STATUS_TRANSITIONS, shopStatusSchema, shopTransitionTargets } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_SHOP_ACTION_TARGET,
  getAdminShopActions,
  type AdminShopAction,
} from './admin-shop-actions';

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
