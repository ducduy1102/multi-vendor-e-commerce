import { SHOP_EDITABLE_STATUSES, shopStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { getShopFormMode, type ShopFormMode } from './shop-form-mode';
import type { Shop } from './types';

describe('getShopFormMode', () => {
  it.each<[Shop['status'], ShopFormMode]>([
    ['PENDING', 'readonly'], // đang chờ duyệt: khoá
    ['SUSPENDED', 'readonly'], // đang bị khoá: khoá
    ['REJECTED', 'resubmit'], // sửa xong gửi duyệt lại
    ['APPROVED', 'edit'], // sửa như hiện tại
  ])('shop %s => chế độ %s', (status, expected) => {
    expect(getShopFormMode(status)).toBe(expected);
  });

  // FE không tự suy luật: khoá/mở form phải khớp đúng tập trạng thái BE cho phép sửa.
  it.each(shopStatusSchema.options)(
    '%s: form khoá <=> BE không cho sửa (cùng SHOP_EDITABLE_STATUSES)',
    (status) => {
      const editableByServer = SHOP_EDITABLE_STATUSES.includes(status);

      expect(getShopFormMode(status) !== 'readonly').toBe(editableByServer);
    },
  );

  it('chỉ shop REJECTED mới có nút "gửi duyệt lại"', () => {
    const resubmitStatuses = shopStatusSchema.options.filter(
      (status) => getShopFormMode(status) === 'resubmit',
    );

    expect(resubmitStatuses).toEqual(['REJECTED']);
  });
});
