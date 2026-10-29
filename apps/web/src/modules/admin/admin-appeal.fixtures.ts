import type { AdminAppeal, AdminAppealListResponse } from './types';

// Dữ liệu giả cho test hàng đợi kháng nghị (Week11.md 4.6).
export function makeAppeal(overrides: Partial<AdminAppeal> = {}): AdminAppeal {
  return {
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
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
    owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
    ...overrides,
  };
}

export function makeAppealPage(
  items: AdminAppeal[],
  overrides: Partial<Omit<AdminAppealListResponse, 'items'>> = {},
): AdminAppealListResponse {
  return { items, total: items.length, page: 1, limit: 20, ...overrides };
}
