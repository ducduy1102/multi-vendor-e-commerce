'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { formatPrice } from '../format-price';
import { useMyProducts } from '../hooks/useMyProducts';
import { useUpdateProductStatus } from '../hooks/useUpdateProductStatus';
import type { ProductListItem } from '../types';
import { SellerProductsListSkeleton } from './SellerProductsListSkeleton';

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

// ARCHIVED: --secondary/--muted mặc định của variant="secondary" gần như
// trắng ở light mode (cùng giá trị oklch với --muted), khiến badge gần như
// hoà vào nền trắng — nhìn giống hệt DRAFT (chỉ có viền nhạt) dù variant đã
// khác. Ghi đè nền đậm hơn (muted-foreground/15) + chữ đậm (text-foreground
// thay vì text-secondary-foreground) + border-border để tương phản rõ với
// nền trắng, đồng thời rõ hơn DRAFT (nền trong suốt, chữ mờ muted-foreground)
// — vẫn giữ trung tính (không thêm hue mới) vì ARCHIVED là trạng thái ngừng
// hoạt động, không phải cảnh báo (--warning) hay nguy hiểm (--destructive).
const STATUS_BADGE_CLASS = {
  DRAFT: 'border-border text-muted-foreground',
  PUBLISHED: 'border-success/30 bg-success/10 text-success',
  ARCHIVED: 'border-border bg-muted-foreground/15 text-foreground',
} as const satisfies Record<ProductListItem['status'], string>;

// Badge mặc định (badge.tsx) cỡ text-xs/h-5/rounded-4xl (pill) — nhỏ và bo
// tròn hơn rõ rệt so với text-[0.8rem]/h-7/rounded-[min(var(--radius-md),12px)]
// của Button size="sm" đặt cạnh (nút "Sửa"/"Lưu trữ"), gây mất cân đối thị
// giác. Khớp đúng cả chiều cao lẫn border-radius (không chỉ cỡ chữ) để viền
// badge thẳng hàng và cùng độ bo với viền nút cạnh bên — dùng lại đúng giá
// trị radius của Button size="sm" thay vì rounded-lg (radius mặc định của
// buttonVariants) vì size="sm" tự override radius riêng, không kế thừa giá
// trị base. Tăng CHỈ ở đây qua className, không đổi mặc định global của
// Badge (nơi khác có thể cần cỡ nhỏ/pill).
const STATUS_BADGE_SIZE_CLASS = 'h-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-sm';

// Nhận shopId qua prop (đã resolve sẵn ở app/seller/products/page.tsx) —
// không tự gọi useMyShop() ở đây: modules/product không được cross-import
// modules/shop (rules/general.md mục 1), "biết shop của mình" là việc của
// page.tsx (composition root), không phải của module product.
export function SellerProductsContainer({ shopId }: SellerProductsContainerProps) {
  const t = useTranslations('product');
  const tShop = useTranslations('shop');
  const tVoucher = useTranslations('voucher');
  const tCommon = useTranslations('common');
  const myProductsQuery = useMyProducts(shopId);
  const archiveProductMutation = useUpdateProductStatus('ARCHIVED');
  const reactivateProductMutation = useUpdateProductStatus('DRAFT');
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive(id: string) {
    setError(null);
    setArchivingId(id);
    try {
      await archiveProductMutation.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sellerArchiveGenericError'));
    } finally {
      setArchivingId(null);
    }
  }

  function confirmArchive() {
    const id = confirmingId;
    setConfirmingId(null);
    if (id) {
      void handleArchive(id);
    }
  }

  // Không cần AlertDialog xác nhận — khác "Lưu trữ", hành động này không
  // ẩn sản phẩm khỏi seller hay mất dữ liệu gì (chỉ đưa ARCHIVED -> DRAFT).
  async function handleReactivate(id: string) {
    setError(null);
    setReactivatingId(id);
    try {
      await reactivateProductMutation.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sellerReactivateGenericError'));
    } finally {
      setReactivatingId(null);
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
          {/* Chỉ là 1 link tới route /seller/vouchers, không import gì từ
              modules/voucher (chỉ mượn chuỗi dịch theo namespace). */}
          <Link
            href="/seller/vouchers"
            className="shrink-0 text-sm font-medium text-foreground hover:underline"
          >
            {tVoucher('manageLink')}
          </Link>
          <Link
            href="/seller/products/new"
            className={buttonVariants({ variant: 'default', className: 'shrink-0' })}
          >
            {t('sellerCreateProduct')}
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}

      {myProductsQuery.isPending ? (
        <div aria-busy="true">
          <span className="sr-only">{tCommon('loading')}</span>
          <SellerProductsListSkeleton />
        </div>
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
                    className={cn(STATUS_BADGE_SIZE_CLASS, STATUS_BADGE_CLASS[product.status])}
                  >
                    {t(STATUS_LABEL_KEY[product.status])}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/seller/products/${product.id}/edit`} />}
                  >
                    {t('sellerEditAction')}
                  </Button>
                  {product.status === 'ARCHIVED' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={reactivatingId === product.id}
                      onClick={() => void handleReactivate(product.id)}
                    >
                      {reactivatingId === product.id
                        ? t('sellerReactivating')
                        : t('sellerReactivateAction')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={archivingId === product.id}
                      onClick={() => setConfirmingId(product.id)}
                    >
                      {archivingId === product.id ? t('sellerArchiving') : t('sellerArchiveAction')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={confirmingId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sellerArchiveAction')}</AlertDialogTitle>
            <AlertDialogDescription>{t('sellerArchiveConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmArchive}>
              {t('sellerArchiveAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
