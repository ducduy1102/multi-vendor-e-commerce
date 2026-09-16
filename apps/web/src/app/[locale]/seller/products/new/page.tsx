'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { CreateProductFormContainer } from '@/modules/product';
import { useMyShop } from '@/modules/shop';

// Cùng ngoại lệ đã ghi ở app/seller/products/page.tsx (Week4.md Bước 3.6) —
// tạo product cần biết "shop của tôi" (POST /shops/:shopId/products), việc
// ghép nối module product/shop chỉ được làm ở app/ (composition root).
export default function NewProductPage() {
  const t = useTranslations('shop');
  const tProduct = useTranslations('product');
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
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
        {myShopQuery.isError ? (
          <p className="text-sm text-destructive">{t('loadShopError')}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold text-foreground">
        {tProduct('createProductTitle')}
      </h1>
      <CreateProductFormContainer shopId={myShopQuery.data.id} />
    </div>
  );
}
