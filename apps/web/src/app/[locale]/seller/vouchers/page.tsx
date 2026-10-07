'use client';

import { SellerVouchersContainer, VoucherListSkeleton } from '@/modules/voucher';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../_components/SellerShopGate';

// Composition root giống seller/products/page.tsx: trang cần biết "shop của
// user hiện tại" (modules/shop) để quản lý voucher (modules/voucher) — 2 module
// không được cross-import lẫn nhau (rules/general.md mục 1) nên phần ghép nối
// nằm ở app/. Phần resolve shop (loading/lỗi/chưa có shop) nằm ở
// SellerShopGate. Tự động được bảo vệ đăng nhập vì nằm dưới prefix /seller ở
// proxy.ts (Week6.md 1.16).
export default function SellerVouchersPage() {
  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
              <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
            </div>
          </div>
          <VoucherListSkeleton />
        </>
      }
    >
      {(shopId) => <SellerVouchersContainer shopId={shopId} />}
    </SellerShopGate>
  );
}
