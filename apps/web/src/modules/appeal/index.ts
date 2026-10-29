// Barrel export cho module appeal (kháng nghị của shop, Week11.md 4.6) — module LÁ: không import module nghiệp vụ nào và không
// module nào import nó (shared/lib/module-boundaries.test.ts). Mục kháng nghị được ghép vào trang `/seller/shop` ở
// `app/[locale]/seller/shop/_components/SellerShopAppealEntry`. Không export sâu file nội bộ.
export { ShopAppealSection } from './components/ShopAppealSection';
export { shopAppealsQueryKey } from './hooks/appeal-query-keys';
export * as appealService from './services/appeal.service';
export type { AppealState, OwnerAppeal, ShopAppealsResponse } from './types';
