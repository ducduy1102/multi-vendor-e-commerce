'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ApiError } from '@/shared/lib/api-client';

import { useMyShop } from '../hooks/useMyShop';
import { useUpdateShop } from '../hooks/useUpdateShop';
import type { Shop, UpdateShopInput } from '../types';
import { ShopFormFieldsSkeleton } from './ShopFormFieldsSkeleton';
import { UpdateShopForm } from './UpdateShopForm';

const SHOP_STATUS_ALERT = {
  PENDING: { variant: 'warning', messageKey: 'shopStatusPendingMessage' },
  APPROVED: null,
  REJECTED: { variant: 'destructive', messageKey: 'shopStatusRejectedMessage' },
  SUSPENDED: { variant: 'destructive', messageKey: 'shopStatusSuspendedMessage' },
} as const satisfies Record<
  Shop['status'],
  { variant: 'warning' | 'destructive'; messageKey: string } | null
>;

// Nối UpdateShopForm (Bước 3.8) với useMyShop/useUpdateShop (Bước 3.5) — đặt
// trong modules/ để app/seller/shop/page.tsx chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1).
export function ShopDashboardContainer() {
  const t = useTranslations('shop');
  const tProduct = useTranslations('product');
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
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only">{tCommon('loading')}</span>
        <div aria-hidden="true" className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
        </div>
        <ShopFormFieldsSkeleton />
      </div>
    );
  }

  const shop = myShopQuery.data;
  const statusAlert = SHOP_STATUS_ALERT[shop.status];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{shop.name}</h1>
          <p className="text-sm text-muted-foreground">/{shop.slug}</p>
        </div>
        <Link
          href="/seller/products"
          className="text-sm font-medium text-foreground hover:underline"
        >
          {tProduct('manageProductsLink')}
        </Link>
      </div>

      {statusAlert && <Alert variant={statusAlert.variant}>{t(statusAlert.messageKey)}</Alert>}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {successMessage && <p className="text-sm text-success">{successMessage}</p>}

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
