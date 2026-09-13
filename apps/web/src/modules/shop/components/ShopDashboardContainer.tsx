'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/shared/lib/api-client';

import { useMyShop } from '../hooks/useMyShop';
import { useUpdateShop } from '../hooks/useUpdateShop';
import type { UpdateShopInput } from '../types';
import { UpdateShopForm } from './UpdateShopForm';

// Nối UpdateShopForm (Bước 3.8) với useMyShop/useUpdateShop (Bước 3.5) — đặt
// trong modules/ để app/seller/shop/page.tsx chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1).
export function ShopDashboardContainer() {
  const t = useTranslations('shop');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const myShopQuery = useMyShop();
  const updateShop = useUpdateShop();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Chưa có shop (query resolve xong nhưng data null, khác isPending) thì
  // không có gì để quản lý — điều hướng sang onboarding (đối xứng với
  // BecomeSellerFormContainer điều hướng ngược lại khi đã có shop).
  useEffect(() => {
    if (myShopQuery.isSuccess && !myShopQuery.data) {
      router.push('/seller/onboarding');
    }
  }, [myShopQuery.isSuccess, myShopQuery.data, router]);

  async function handleSubmit(values: UpdateShopInput) {
    if (!myShopQuery.data) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await updateShop.mutateAsync({ id: myShopQuery.data.id, values });
      setSuccessMessage(t('updateShopSuccess'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('updateShopGenericError'));
    }
  }

  // isPending lúc đầu, hoặc resolve xong nhưng chưa có data (đang chờ
  // useEffect điều hướng ở trên) — không render dashboard/form nhầm.
  if (myShopQuery.isPending || !myShopQuery.data) {
    if (myShopQuery.isError) {
      return <p className="text-sm text-destructive">{t('loadShopError')}</p>;
    }
    return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  }

  const shop = myShopQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{shop.name}</h1>
        <p className="text-sm text-muted-foreground">/{shop.slug}</p>
      </div>

      {shop.status !== 'APPROVED' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {t('shopStatusPendingMessage')}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {successMessage && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>
      )}

      <UpdateShopForm
        defaultValues={{
          name: shop.name,
          description: shop.description ?? undefined,
          logoUrl: shop.logoUrl ?? undefined,
          bannerUrl: shop.bannerUrl ?? undefined,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateShop.isPending}
      />
    </div>
  );
}
