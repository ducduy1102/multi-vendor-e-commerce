import type { AdminAppeal, AdminAppealListResponse } from './types';

// Dữ liệu giả cho test hàng đợi kháng nghị (Week11.md 4.6): mặc định là kháng nghị của SHOP bị khoá.
export function makeAppeal(overrides: Partial<AdminAppeal> = {}): AdminAppeal {
  return {
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
    targetType: 'SHOP',
    state: 'PENDING',
    message: 'Shop đã gỡ các sản phẩm bị báo cáo và bổ sung giấy tờ nguồn gốc.',
    decisionNote: null,
    decidedByName: null,
    createdAt: '2026-10-29T08:00:00.000Z',
    decidedAt: null,
    moderationEventAt: '2026-10-28T10:00:00.000Z',
    shop: {
      id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
      name: 'Shop Thời Trang ABC',
      slug: 'shop-thoi-trang-abc',
      logoUrl: null,
      status: 'SUSPENDED',
      statusReason: 'Bán hàng giả',
    },
    product: null,
    owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
    ...overrides,
  };
}

// Kháng nghị của SẢN PHẨM bị gỡ (Week11.md 5.8): `shop` là shop sở hữu sản phẩm (vẫn hoạt động bình thường), lý do gỡ nằm ở `product`.
export function makeProductAppeal(overrides: Partial<AdminAppeal> = {}): AdminAppeal {
  return makeAppeal({
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000002',
    targetType: 'PRODUCT',
    message: 'Sản phẩm đã bổ sung giấy tờ nguồn gốc và chỉnh lại mô tả.',
    shop: {
      id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
      name: 'Shop Thời Trang ABC',
      slug: 'shop-thoi-trang-abc',
      logoUrl: null,
      status: 'APPROVED',
      statusReason: null,
    },
    product: {
      id: 'c4a2d3f1-1234-4a5b-8c9d-abcdef654321',
      name: 'Dao bấm tự động',
      slug: 'dao-bam-tu-dong',
      takenDownReason: 'Hàng cấm theo quy định của sàn.',
    },
    ...overrides,
  });
}

export function makeAppealPage(
  items: AdminAppeal[],
  overrides: Partial<Omit<AdminAppealListResponse, 'items'>> = {},
): AdminAppealListResponse {
  return { items, total: items.length, page: 1, limit: 20, ...overrides };
}
