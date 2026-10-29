import type { OwnerAppeal, ShopAppealsResponse } from './types';

// Dữ liệu mẫu cho test của module appeal (không phải mã chạy thật).
export function makeOwnerAppeal(overrides: Partial<OwnerAppeal> = {}): OwnerAppeal {
  return {
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
    state: 'PENDING',
    message: 'Shop đã gỡ các sản phẩm bị báo cáo và bổ sung giấy tờ.',
    decisionNote: null,
    createdAt: '2026-10-29T08:00:00.000Z',
    decidedAt: null,
    moderationEventAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

export function makeShopAppeals(overrides: Partial<ShopAppealsResponse> = {}): ShopAppealsResponse {
  return { appeals: [], canAppeal: false, ...overrides };
}
