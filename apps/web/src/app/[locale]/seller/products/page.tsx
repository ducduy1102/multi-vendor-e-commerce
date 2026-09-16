'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { SellerProductsContainer } from '@/modules/product';
import { useMyShop } from '@/modules/shop';

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
    return (
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        {myShopQuery.isError ? (
          <p className="text-sm text-destructive">{t('loadShopError')}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <SellerProductsContainer shopId={myShopQuery.data.id} />
    </div>
  );
}
