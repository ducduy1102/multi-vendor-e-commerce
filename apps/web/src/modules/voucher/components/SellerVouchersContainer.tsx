'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
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
import { Button } from '@/shared/components/ui/button';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

import { useCreateVoucher } from '../hooks/useCreateVoucher';
import { useSetVoucherActive } from '../hooks/useSetVoucherActive';
import { useShopVouchers } from '../hooks/useShopVouchers';
import { toCreateVoucherInput, type VoucherFormValues } from '../schemas/voucher.schema';
import type { Voucher } from '../types';
import { VoucherForm } from './VoucherForm';
import { VoucherListSkeleton } from './VoucherListSkeleton';

interface SellerVouchersContainerProps {
  shopId: string;
}

type VoucherStatus = 'active' | 'inactive' | 'expired';

// "Hết hạn" ưu tiên hơn "Đang bật/Đã tắt": voucher quá hạn không dùng được
// dù cờ isActive còn bật.
function getStatus(voucher: Voucher, now: number): VoucherStatus {
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= now) return 'expired';
  return voucher.isActive ? 'active' : 'inactive';
}

// Đang bật dùng --success như badge PUBLISHED của sản phẩm; tắt/hết hạn giữ
// trung tính (không dùng --destructive/--warning — dành cho trạng thái nguy
// hiểm/cảnh báo, rules/frontend.md "UI polish" mục 2).
const STATUS_BADGE_VARIANT = {
  active: 'outline',
  inactive: 'secondary',
  expired: 'secondary',
} as const satisfies Record<VoucherStatus, 'outline' | 'secondary'>;

const STATUS_BADGE_CLASS = {
  active: 'border-success/30 bg-success/10 text-success',
  inactive: '',
  expired: '',
} as const satisfies Record<VoucherStatus, string>;

const STATUS_LABEL_KEY = {
  active: 'statusActive',
  inactive: 'statusInactive',
  expired: 'statusExpired',
} as const satisfies Record<VoucherStatus, string>;

// Nhận shopId qua prop (đã resolve ở app/seller/vouchers/page.tsx) — không tự
// gọi useMyShop(): modules/voucher không được cross-import modules/shop
// (rules/general.md mục 1), "biết shop của mình" là việc của page.tsx
// (composition root), y hệt SellerProductsContainer.
export function SellerVouchersContainer({ shopId }: SellerVouchersContainerProps) {
  const t = useTranslations('voucher');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const vouchersQuery = useShopVouchers(shopId);
  const createMutation = useCreateVoucher(shopId);
  const setActiveMutation = useSetVoucherActive(shopId);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmingVoucher, setConfirmingVoucher] = useState<Voucher | null>(null);
  const [pendingVoucherId, setPendingVoucherId] = useState<string | null>(null);
  // Chốt "bây giờ" 1 lần lúc mount (hàm thuần khi render — Date.now() trực
  // tiếp trong render vi phạm quy tắc purity của React Compiler).
  const [now] = useState(() => Date.now());

  async function handleCreate(values: VoucherFormValues) {
    setFormError(null);
    try {
      await createMutation.mutateAsync(toCreateVoucherInput(values));
      toast.success(t('createSuccess'));
      setIsFormOpen(false);
    } catch (error) {
      // Không lộ message tiếng Anh của BE: 409 = trùng mã, còn lại lỗi chung.
      setFormError(
        error instanceof ApiError && error.status === 409 ? t('createConflict') : t('createError'),
      );
    }
  }

  async function setActive(voucher: Voucher, isActive: boolean) {
    setListError(null);
    setPendingVoucherId(voucher.id);
    try {
      await setActiveMutation.mutateAsync({ voucherId: voucher.id, isActive });
    } catch {
      setListError(t('toggleError'));
    } finally {
      setPendingVoucherId(null);
    }
  }

  function confirmDeactivate() {
    const voucher = confirmingVoucher;
    setConfirmingVoucher(null);
    if (voucher) void setActive(voucher, false);
  }

  function describe(voucher: Voucher): string {
    const parts: string[] = [];
    if (voucher.minOrderAmount) {
      parts.push(t('minOrderInfo', { amount: formatPrice(voucher.minOrderAmount) }));
    }
    if (voucher.type === 'PERCENT' && voucher.maxDiscountAmount) {
      parts.push(t('maxDiscountInfo', { amount: formatPrice(voucher.maxDiscountAmount) }));
    }
    parts.push(
      voucher.usageLimit === null
        ? t('usedInfo', { used: voucher.usedCount })
        : t('usedLimitInfo', { used: voucher.usedCount, limit: voucher.usageLimit }),
    );
    if (voucher.perUserLimit !== null) {
      parts.push(t('perUserInfo', { count: voucher.perUserLimit }));
    }
    parts.push(
      voucher.expiresAt
        ? t('expiresInfo', {
            // Giờ địa phương của trình duyệt — khớp ô datetime-local lúc tạo,
            // và tránh cảnh báo ENVIRONMENT_FALLBACK của next-intl (app chưa
            // cấu hình timeZone mặc định). Danh sách chỉ render ở client sau
            // khi query xong nên không có nguy cơ lệch hydration server/client.
            date: format.dateTime(new Date(voucher.expiresAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          })
        : t('noExpiry'),
    );
    return parts.join(' · ');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/seller/products"
            className="shrink-0 text-sm font-medium text-foreground hover:underline"
          >
            {t('backToProducts')}
          </Link>
          <Button
            type="button"
            aria-expanded={isFormOpen}
            aria-controls="voucher-create-section"
            onClick={() => {
              setFormError(null);
              setIsFormOpen((open) => !open);
            }}
          >
            {isFormOpen ? tCommon('cancel') : t('createButton')}
          </Button>
        </div>
      </div>

      {isFormOpen ? (
        <section
          id="voucher-create-section"
          aria-label={t('createTitle')}
          className="flex flex-col gap-4 rounded-lg border border-border p-4"
        >
          <h2 className="text-base font-semibold text-foreground">{t('createTitle')}</h2>
          {formError && (
            <Alert variant="destructive" role="alert">
              {formError}
            </Alert>
          )}
          <VoucherForm onSubmit={handleCreate} isSubmitting={createMutation.isPending} />
        </section>
      ) : null}

      {listError && (
        <Alert variant="destructive" role="alert">
          {listError}
        </Alert>
      )}

      {vouchersQuery.isPending ? (
        <div aria-busy="true">
          <span className="sr-only">{tCommon('loading')}</span>
          <VoucherListSkeleton />
        </div>
      ) : vouchersQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : vouchersQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border rounded-lg border border-border"
        >
          {vouchersQuery.data.map((voucher) => {
            const status = getStatus(voucher, now);
            const isPending = pendingVoucherId === voucher.id;

            return (
              <li key={voucher.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{voucher.code}</span>
                    <span className="text-sm font-medium text-foreground">
                      {voucher.type === 'PERCENT'
                        ? t('valuePercent', { value: Number(voucher.value) })
                        : t('valueFixed', { amount: formatPrice(voucher.value) })}
                    </span>
                    <Badge
                      variant={STATUS_BADGE_VARIANT[status]}
                      className={cn(STATUS_BADGE_CLASS[status])}
                    >
                      {t(STATUS_LABEL_KEY[status])}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{describe(voucher)}</span>
                </div>

                {status === 'expired' ? null : status === 'active' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setConfirmingVoucher(voucher)}
                  >
                    {t('deactivateAction')}
                  </Button>
                ) : (
                  // Bật lại không cần xác nhận (dễ hoàn tác, không ảnh hưởng
                  // ai — khác tắt voucher đang chạy).
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void setActive(voucher, true)}
                  >
                    {t('activateAction')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={confirmingVoucher !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingVoucher(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deactivateAction')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deactivateConfirm', { code: confirmingVoucher?.code ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeactivate}>
              {t('deactivateAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
