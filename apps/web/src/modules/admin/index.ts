// Barrel export cho module admin — export những gì app/ cần (trang
// /admin/shops). Không export sâu file nội bộ (shared/lib/module-boundaries.test.ts
// kiểm điều này) — mở rộng dần ở 3.1+.
export type {
  AdminShop,
  AdminShopListQuery,
  AdminShopListResponse,
  AdminShopTargetStatus,
  AdminUpdateShopStatusInput,
} from './types';
