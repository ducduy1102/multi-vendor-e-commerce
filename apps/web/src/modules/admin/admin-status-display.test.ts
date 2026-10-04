import { shopStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  ADMIN_SHOP_STATUS_DISPLAY,
  ADMIN_SHOP_TAB_STATUSES,
  DEFAULT_ADMIN_SHOP_STATUS,
} from './admin-status-display';

// Key tra theo enum lúc chạy nên TypeScript không kiểm được — test này đảm bảo mọi trạng thái đều có
// bản dịch ở CẢ vi lẫn en (thiếu key next-intl chỉ báo lỗi console rồi hiện key thô).
describe('ADMIN_SHOP_STATUS_DISPLAY', () => {
  it('có đủ mọi trạng thái của enum dùng chung', () => {
    expect(Object.keys(ADMIN_SHOP_STATUS_DISPLAY).sort()).toEqual(
      [...shopStatusSchema.options].sort(),
    );
  });

  it.each(shopStatusSchema.options)(
    '%s có nhãn và câu "danh sách trống" ở cả vi và en',
    (status) => {
      const { labelKey, emptyKey } = ADMIN_SHOP_STATUS_DISPLAY[status];

      for (const messages of [vi.admin, en.admin] as Record<string, string>[]) {
        expect(messages[labelKey]).toBeTruthy();
        expect(messages[emptyKey]).toBeTruthy();
      }
    },
  );
});

describe('tab trạng thái', () => {
  it('đủ 4 tab theo đúng thứ tự enum dùng chung, không có tab "Tất cả" (BE luôn lọc theo 1 trạng thái)', () => {
    expect(ADMIN_SHOP_TAB_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
  });

  it('tab mặc định là hàng chờ duyệt, khớp mặc định của BE', () => {
    expect(DEFAULT_ADMIN_SHOP_STATUS).toBe('PENDING');
    expect(ADMIN_SHOP_TAB_STATUSES[0]).toBe(DEFAULT_ADMIN_SHOP_STATUS);
  });
});
