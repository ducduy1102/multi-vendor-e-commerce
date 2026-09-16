'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';
import { useArchiveProduct } from '../hooks/useArchiveProduct';
import { useMyProducts } from '../hooks/useMyProducts';
import type { ProductListItem } from '../types';

interface SellerProductsContainerProps {
  shopId: string;
}

const STATUS_LABEL_KEY = {
  DRAFT: 'statusDraft',
  PUBLISHED: 'statusPublished',
  ARCHIVED: 'statusArchived',
} as const satisfies Record<ProductListItem['status'], string>;

function formatPrice(value: string): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(Number(value));
}

// Nhận shopId qua prop (đã resolve sẵn ở app/seller/products/page.tsx) —
// không tự gọi useMyShop() ở đây: modules/product không được cross-import
// modules/shop (rules/general.md mục 1), "biết shop của mình" là việc của
// page.tsx (composition root), không phải của module product.
export function SellerProductsContainer({ shopId }: SellerProductsContainerProps) {
  const t = useTranslations('product');
  const tCommon = useTranslations('common');
  const myProductsQuery = useMyProducts(shopId);
  const archiveProduct = useArchiveProduct();
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive(id: string) {
    if (!window.confirm(t('sellerArchiveConfirm'))) {
      return;
    }
    setError(null);
    setArchivingId(id);
    try {
      await archiveProduct.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sellerArchiveGenericError'));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t('sellerProductsTitle')}</h1>
        <Link href="/seller/products/new" className={buttonVariants({ variant: 'default' })}>
          {t('sellerCreateProduct')}
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {myProductsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : myProductsQuery.isError ? (
        <p className="text-sm text-destructive">{t('sellerLoadProductsError')}</p>
      ) : myProductsQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sellerEmptyState')}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {myProductsQuery.data.map((product) => {
            const priceLabel =
              product.minPrice === product.maxPrice
                ? formatPrice(product.minPrice)
                : `${formatPrice(product.minPrice)} - ${formatPrice(product.maxPrice)}`;

            return (
              <div key={product.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{priceLabel}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {t(STATUS_LABEL_KEY[product.status])}
                  </span>
                  <Link
                    href={`/seller/products/${product.id}/edit`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {t('sellerEditAction')}
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={product.status === 'ARCHIVED' || archivingId === product.id}
                    onClick={() => handleArchive(product.id)}
                  >
                    {archivingId === product.id ? t('sellerArchiving') : t('sellerArchiveAction')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
