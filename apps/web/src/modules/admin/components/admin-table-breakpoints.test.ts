import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_REFUND_FIELD_LABEL_CLASS,
  ADMIN_REFUND_GRID_CLASS,
  ADMIN_REFUND_HEADER_CLASS,
} from './admin-refund-row.constants';
import {
  ADMIN_SHOP_ACTIONS_INLINE_CLASS,
  ADMIN_SHOP_ACTIONS_STACKED_CLASS,
  ADMIN_SHOP_FIELD_LABEL_CLASS,
  ADMIN_SHOP_FULL_ROW_CELL_CLASS,
  ADMIN_SHOP_GRID_CLASS,
  ADMIN_SHOP_HEADER_CLASS,
} from './admin-shop-row.constants';
import { ADMIN_USER_GRID_CLASS, ADMIN_USER_HEADER_CLASS } from './admin-user-row.constants';

// Week11.md 4.5, dòng 3: ở 768–1279px vùng bảng chỉ còn 734px nên tên shop còn ~9 ký tự và số tiền của đơn bị cắt. Bảng shop và
// bảng hoàn tiền chỉ là BẢNG từ lg (1024px, vùng nội dung ≥ 992px vì sidebar chỉ từ xl); dưới đó là thẻ như mobile.
const hasToken = (classes: string, prefix: string) =>
  classes.split(/\s+/).some((token) => token.startsWith(prefix));

describe('ngưỡng bảng của /admin/shops và /admin/refunds', () => {
  const TABLE_CLASSES = {
    'lưới shop': ADMIN_SHOP_GRID_CLASS,
    'tiêu đề shop': ADMIN_SHOP_HEADER_CLASS,
    'nhãn trường shop': ADMIN_SHOP_FIELD_LABEL_CLASS,
    'nút xếp dọc (shop)': ADMIN_SHOP_ACTIONS_STACKED_CLASS,
    'nút một hàng (shop)': ADMIN_SHOP_ACTIONS_INLINE_CLASS,
    'ô chiếm cả hàng (shop)': ADMIN_SHOP_FULL_ROW_CELL_CLASS,
    'lưới hoàn tiền': ADMIN_REFUND_GRID_CLASS,
    'tiêu đề hoàn tiền': ADMIN_REFUND_HEADER_CLASS,
    'nhãn trường hoàn tiền': ADMIN_REFUND_FIELD_LABEL_CLASS,
  } as const;

  it.each(Object.entries(TABLE_CLASSES))('%s: dùng ngưỡng lg, không còn md:', (_name, classes) => {
    expect(hasToken(classes, 'md:')).toBe(false);
    expect(hasToken(classes, 'lg:')).toBe(true);
  });

  it('các thành phần dòng/tiêu đề/skeleton không còn class md: (lệch với hằng số ⇒ tiêu đề lệch cột hoặc nút tràn ô)', () => {
    const files = [
      'AdminShopRow.tsx',
      'AdminShopActions.tsx',
      'AdminShopListHeader.tsx',
      'AdminShopListSkeleton.tsx',
      'AdminRefundRequestRow.tsx',
      'AdminRefundRow.tsx',
      'AdminRefundablePaymentRow.tsx',
      'AdminRefundListHeader.tsx',
      'AdminRefundListSkeleton.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/["'`\s]md:[a-z[]/);
    }
  });

  it('bảng người dùng KHÔNG thuộc dòng 3: giữ ngưỡng md cho cả lưới lẫn tiêu đề (tiêu đề không được lệch ngưỡng với lưới)', () => {
    expect(hasToken(ADMIN_USER_GRID_CLASS, 'md:')).toBe(true);
    expect(hasToken(ADMIN_USER_HEADER_CLASS, 'md:')).toBe(true);
    expect(hasToken(ADMIN_USER_HEADER_CLASS, 'lg:')).toBe(false);
  });
});
