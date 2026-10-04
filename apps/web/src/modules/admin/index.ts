// Barrel export cho module admin — export những gì app/ cần (trang
// /admin/shops). Không export sâu file nội bộ (shared/lib/module-boundaries.test.ts
// kiểm điều này).
export { AdminShopsContainer } from './components/AdminShopsContainer';
export { parseAdminShopsPageQuery } from './admin-shops-page-query';
export { adminShopListQueryKey, adminShopListsQueryKey } from './hooks/admin-query-keys';
export { useAdminShops } from './hooks/useAdminShops';
export { useUpdateShopStatus } from './hooks/useUpdateShopStatus';
export * as adminService from './services/admin.service';
export type {
  AdminShop,
  AdminShopListQuery,
  AdminShopListResponse,
  AdminShopTargetStatus,
  AdminUpdateShopStatusInput,
  ShopStatus,
} from './types';
