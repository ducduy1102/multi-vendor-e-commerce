'use client';

import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { useTranslations } from 'next-intl';

import { Alert } from '@/shared/components/ui/alert';

import type { Shop } from '../types';

const SHOP_STATUS_ALERT = {
  PENDING: { variant: 'warning', messageKey: 'shopStatusPendingMessage' },
  APPROVED: null,
  REJECTED: { variant: 'destructive', messageKey: 'shopStatusRejectedMessage' },
  SUSPENDED: { variant: 'destructive', messageKey: 'shopStatusSuspendedMessage' },
} as const satisfies Record<
  Shop['status'],
  { variant: 'warning' | 'destructive'; messageKey: string } | null
>;

interface ShopStatusBannerProps {
  status: Shop['status'];
  // Lý do Admin nhập khi từ chối/khoá (Shop.statusReason) — null khi chờ duyệt/đã duyệt. Khi shop bị tự động tạm ngừng
  // vì tài khoản chủ shop bị khoá/cấm, giá trị là MÃ SHOP_CASCADE_SUSPEND_REASON (không phải văn bản) và được dịch ở đây.
  reason: string | null;
}

// Banner trạng thái shop ở trang quản lý shop của Seller: chờ duyệt, bị từ chối, bị khoá (đã duyệt
// thì không hiện gì). Từ chối/khoá kèm LÝ DO của Admin để Seller biết vì sao. Lý do là văn bản tự do
// do Admin nhập — hiện dạng text (React tự escape), `break-words` để chuỗi dài không làm tràn banner.
// Component THUẦN trình bày.
export function ShopStatusBanner({ status, reason }: ShopStatusBannerProps) {
  const t = useTranslations('shop');
  const alert = SHOP_STATUS_ALERT[status];

  if (!alert) {
    return null;
  }

  return (
    <Alert variant={alert.variant}>
      <p>{t(alert.messageKey)}</p>
      {reason ? (
        <p className="mt-1 font-medium break-words">
          {reason === SHOP_CASCADE_SUSPEND_REASON
            ? t('shopStatusReasonOwnerSuspended')
            : t('shopStatusReason', { reason })}
        </p>
      ) : null}
    </Alert>
  );
}
