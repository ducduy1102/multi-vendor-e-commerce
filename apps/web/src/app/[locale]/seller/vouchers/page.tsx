'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useMyShop } from '@/modules/shop';
import { SellerVouchersContainer, VoucherListSkeleton } from '@/modules/voucher';
import { Skeleton } from '@/shared/components/ui/skeleton';

// Composition root giống seller/products/page.tsx: trang cần biết "shop của
// user hiện tại" (modules/shop) để quản lý voucher (modules/voucher) — 2 module
// không được cross-import lẫn nhau (rules/general.md mục 1) nên phần ghép nối
// nằm ở app/. Tự động được bảo vệ đăng nhập vì nằm dưới prefix /seller ở
// proxy.ts (Week6.md 1.16).
export default function SellerVouchersPage() {
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
          <p role="alert" className="text-sm text-destructive">
            {t('loadShopError')}
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <div aria-busy="true" className="flex flex-col gap-6">
          <span className="sr-only">{tCommon('loading')}</span>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
              <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
            </div>
          </div>
          <VoucherListSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <SellerVouchersContainer shopId={myShopQuery.data.id} />
    </div>
  );
}
