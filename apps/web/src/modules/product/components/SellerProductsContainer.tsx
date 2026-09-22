'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';
import { formatPrice } from '../format-price';
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

// PUBLISHED dùng --success (đang lên sàn, thấy được ngay giữa danh sách);
// DRAFT giữ outline trung tính (chưa có gì đặc biệt để báo); ARCHIVED đổi
// sang Badge variant="secondary" (nền xám đặc) thay vì opacity-60 trên nền
// outline giống hệt DRAFT — trước đó 2 trạng thái này chỉ khác nhau ở độ mờ,
// dễ nhầm khi liếc nhanh. Không dùng --destructive/--warning (đã dành riêng
// cho banner trạng thái shop, rules/frontend.md mục "UI polish" mục 2).
const STATUS_BADGE_VARIANT = {
  DRAFT: 'outline',
  PUBLISHED: 'outline',
  ARCHIVED: 'secondary',
} as const satisfies Record<ProductListItem['status'], 'outline' | 'secondary'>;

const STATUS_BADGE_CLASS = {
  DRAFT: 'border-border text-muted-foreground',
  PUBLISHED: 'border-success/30 bg-success/10 text-success',
  ARCHIVED: '',
} as const satisfies Record<ProductListItem['status'], string>;

// Nhận shopId qua prop (đã resolve sẵn ở app/seller/products/page.tsx) —
// không tự gọi useMyShop() ở đây: modules/product không được cross-import
// modules/shop (rules/general.md mục 1), "biết shop của mình" là việc của
// page.tsx (composition root), không phải của module product.
export function SellerProductsContainer({ shopId }: SellerProductsContainerProps) {
  const t = useTranslations('product');
  const tShop = useTranslations('shop');
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('sellerProductsTitle')}</h1>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/seller/shop"
            className="shrink-0 text-sm font-medium text-foreground hover:underline"
          >
            {tShop('shopInfoLink')}
          </Link>
          <Link
            href="/seller/products/new"
            className={buttonVariants({ variant: 'default', className: 'shrink-0' })}
          >
            {t('sellerCreateProduct')}
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {myProductsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : myProductsQuery.isError ? (
        <p className="text-sm text-destructive">{t('sellerLoadProductsError')}</p>
      ) : myProductsQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sellerEmptyState')}</p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border rounded-lg border border-border"
        >
          {myProductsQuery.data.map((product) => {
            const priceLabel =
              product.minPrice === product.maxPrice
                ? formatPrice(product.minPrice)
                : `${formatPrice(product.minPrice)} - ${formatPrice(product.maxPrice)}`;

            return (
              <li key={product.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className="truncate text-sm font-medium text-foreground"
                    title={product.name}
                  >
                    {product.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{priceLabel}</span>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <Badge
                    variant={STATUS_BADGE_VARIANT[product.status]}
                    className={STATUS_BADGE_CLASS[product.status]}
                  >
                    {t(STATUS_LABEL_KEY[product.status])}
                  </Badge>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
