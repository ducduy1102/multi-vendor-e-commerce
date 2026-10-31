'use client';

import { ProductAppealButton } from '@/modules/appeal';
import { SellerProductsContainer, SellerProductsListSkeleton } from '@/modules/product';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../_components/SellerShopGate';

// Ngoại lệ có chủ đích so với convention "page.tsx chỉ compose, logic nằm
// trong Container ở modules/" (rules/frontend.md mục 1): trang này cần biết
// "shop của user hiện tại" (module shop) để hiển thị sản phẩm (module
// product) — modules/product và modules/shop không được cross-import lẫn
// nhau (rules/general.md mục 1), nên phần ghép nối 2 domain này phải nằm ở
// app/ (composition root, không phải 1 module cụ thể). Phần resolve shop
// (loading/lỗi/chưa có shop) nằm ở SellerShopGate, dùng chung với các trang
// seller khác (Tuần 3 Bước 3.8 là bản đầu tiên của logic này).
// Cũng là nơi ghép nút kháng nghị (module appeal) vào dòng sản phẩm bị gỡ
// (Week11.md 5.8): product và appeal không được import nhau.
export default function SellerProductsPage() {
  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
              <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
            </div>
          </div>
          <SellerProductsListSkeleton />
        </>
      }
    >
      {(shopId) => (
        <SellerProductsContainer
          shopId={shopId}
          renderProductAppeal={(product) => (
            <ProductAppealButton
              shopId={shopId}
              productId={product.id}
              productName={product.name}
            />
          )}
        />
      )}
    </SellerShopGate>
  );
}
