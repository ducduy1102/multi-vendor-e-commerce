'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { SellerProductsContainer, SellerProductsListSkeleton } from '@/modules/product';
import { useMyShop } from '@/modules/shop';
import { Skeleton } from '@/shared/components/ui/skeleton';

// Ngoại lệ có chủ đích so với convention "page.tsx chỉ compose, logic nằm
// trong Container ở modules/" (rules/frontend.md mục 1): trang này cần biết
// "shop của user hiện tại" (module shop) để hiển thị sản phẩm (module
// product) — modules/product và modules/shop không được cross-import lẫn
// nhau (rules/general.md mục 1), nên phần ghép nối 2 domain này phải nằm ở
// app/ (composition root, không phải 1 module cụ thể). Cùng logic
// resolve/redirect đã dùng ở ShopDashboardContainer (Tuần 3 Bước 3.8).
export default function SellerProductsPage() {
  const t = useTranslations('shop');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const myShopQuery = useMyShop();

  useEffect(() => {
    if (myShopQuery.isSuccess && !myShopQuery.data) {
      router.push('/seller/onboarding');
    }
  }, [myShopQuery.isSuccess, myShopQuery.data, router]);

  if (myShopQuery.isPending || !myShopQuery.data) {
    if (myShopQuery.isError) {
      return (
        <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
          <p className="text-sm text-destructive">{t('loadShopError')}</p>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <div aria-busy="true" className="flex flex-col gap-6">
          <span className="sr-only">{tCommon('loading')}</span>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
              <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
            </div>
          </div>
          <SellerProductsListSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <SellerProductsContainer shopId={myShopQuery.data.id} />
    </div>
  );
}
