// Barrel export cho module appeal (kháng nghị của shop, Week11.md 4.6; kháng nghị sản phẩm bị gỡ, 5.8) — module LÁ: không import module
// nghiệp vụ nào và không module nào import nó (shared/lib/module-boundaries.test.ts). Mục kháng nghị shop được ghép vào trang `/seller/shop`
// ở `app/[locale]/seller/shop/_components/SellerShopAppealEntry`; kháng nghị sản phẩm được ghép vào danh sách sản phẩm (`ProductAppealButton`)
// và trang sửa sản phẩm (`ProductAppealSection`) ở `app/[locale]/seller/products/...`. Không export sâu file nội bộ.
export { ProductAppealButton } from './components/ProductAppealButton';
export { ProductAppealSection } from './components/ProductAppealSection';
export { ShopAppealSection } from './components/ShopAppealSection';
export { productAppealsQueryKey, shopAppealsQueryKey } from './hooks/appeal-query-keys';
export * as appealService from './services/appeal.service';
export type {
  AppealState,
  OwnerAppeal,
  ProductAppealsResponse,
  ShopAppealsResponse,
} from './types';
