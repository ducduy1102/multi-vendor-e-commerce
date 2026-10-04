import { describe, expect, it } from 'vitest';

import { adminShopListQueryKey, adminShopListsQueryKey } from './admin-query-keys';

describe('admin query keys', () => {
  it('key danh sách bắt đầu bằng đúng tiền tố dùng để invalidate mọi tab/trang', () => {
    expect(adminShopListQueryKey({ status: 'PENDING', page: 2 }).slice(0, 3)).toEqual(
      adminShopListsQueryKey(),
    );
  });

  it('mỗi tab và mỗi trang là 1 key riêng (không dùng chung cache)', () => {
    expect(adminShopListQueryKey({ status: 'PENDING' })).not.toEqual(
      adminShopListQueryKey({ status: 'REJECTED' }),
    );
    expect(adminShopListQueryKey({ page: 1 })).not.toEqual(adminShopListQueryKey({ page: 2 }));
  });

  it('tiền tố là nhánh "admin" riêng — làm mới danh sách shop không kéo theo cache của module khác', () => {
    expect(adminShopListsQueryKey().slice(0, 2)).toEqual(['admin', 'shops']);
  });
});
