'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDescribeShopError } from '../hooks/useDescribeShopError';
import { useMyShop } from '../hooks/useMyShop';
import { useResubmitShop } from '../hooks/useResubmitShop';
import { useUpdateShop } from '../hooks/useUpdateShop';
import { getShopFormMode } from '../shop-form-mode';
import type { UpdateShopInput } from '../types';
import { SHOP_EDIT_LOCKED_HINT_ID, ShopEditLockedHint } from './ShopEditLockedHint';
import { ShopFormFieldsSkeleton } from './ShopFormFieldsSkeleton';
import { ShopStatusBanner } from './ShopStatusBanner';
import { UpdateShopForm } from './UpdateShopForm';

// Nối UpdateShopForm (Bước 3.8) với useMyShop/useUpdateShop (Bước 3.5) — đặt
// trong modules/ để app/seller/shop/page.tsx chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1).
export function ShopDashboardContainer() {
  const t = useTranslations('shop');
  const describeError = useDescribeShopError();
  const tProduct = useTranslations('product');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const myShopQuery = useMyShop();
  const updateShop = useUpdateShop();
  const resubmitShop = useResubmitShop();
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

  // Shop REJECTED: nút duy nhất là "Lưu và gửi duyệt lại" — sửa + nộp lại trong 1 request nguyên tử ở BE
  // (Week8.md 3C.1), không có bước "lưu nháp" rồi quên gửi. Shop APPROVED: lưu như cũ. Shop PENDING/
  // SUSPENDED không có nút gửi nên không bao giờ tới đây.
  async function handleSubmit(values: UpdateShopInput) {
    const shop = myShopQuery.data;
    if (!shop) return;
    const mode = getShopFormMode(shop.status);
    if (mode === 'readonly') return;
    setError(null);
    setSuccessMessage(null);
    try {
      if (mode === 'resubmit') {
        await resubmitShop.mutateAsync({ id: shop.id, values });
        setSuccessMessage(t('resubmitShopSuccess'));
      } else {
        await updateShop.mutateAsync({ id: shop.id, values });
        setSuccessMessage(t('updateShopSuccess'));
      }
    } catch (err) {
      setError(
        describeError(
          err,
          mode === 'resubmit' ? t('resubmitShopGenericError') : t('updateShopGenericError'),
        ),
      );
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
  const formMode = getShopFormMode(shop.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold">{shop.name}</h1>
          <p className="truncate text-sm text-muted-foreground">/{shop.slug}</p>
        </div>
        <Link
          href="/seller/products"
          className="shrink-0 text-sm font-medium text-foreground hover:underline"
        >
          {tProduct('manageProductsLink')}
        </Link>
      </div>

      <ShopStatusBanner status={shop.status} reason={shop.statusReason} />

      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert variant="success" role="status">
          {successMessage}
        </Alert>
      )}

      <ShopEditLockedHint status={shop.status} />

      <UpdateShopForm
        isReadOnly={formMode === 'readonly'}
        readOnlyHintId={SHOP_EDIT_LOCKED_HINT_ID}
        submitVariant={formMode === 'resubmit' ? 'resubmit' : 'save'}
        defaultValues={{
          name: shop.name,
          description: shop.description ?? undefined,
          logoUrl: shop.logoUrl ?? undefined,
          bannerUrl: shop.bannerUrl ?? undefined,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateShop.isPending || resubmitShop.isPending}
      />
    </div>
  );
}
