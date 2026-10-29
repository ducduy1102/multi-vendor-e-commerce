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
  // Địa chỉ hỗ trợ từ BE (ENV SUPPORT_EMAIL), null khi không đặt. Chỉ hiện ở từ chối / khoá — cùng điều kiện với email báo trạng thái.
  supportEmail: string | null;
}

// Banner trạng thái shop ở trang quản lý shop của Seller: chờ duyệt, bị từ chối, bị khoá (đã duyệt
// thì không hiện gì). Từ chối/khoá kèm LÝ DO của Admin để Seller biết vì sao. Lý do là văn bản tự do
// do Admin nhập — hiện dạng text (React tự escape), `break-words` để chuỗi dài không làm tràn banner.
// Component THUẦN trình bày.
export function ShopStatusBanner({ status, reason, supportEmail }: ShopStatusBannerProps) {
  const t = useTranslations('shop');
  const alert = SHOP_STATUS_ALERT[status];

  if (!alert) {
    return null;
  }

  const showsSupport = (status === 'REJECTED' || status === 'SUSPENDED') && supportEmail;

  return (
    // `grid-cols-1` (= minmax(0,1fr)): Alert là `grid` không khai cột, cột ngầm định `auto` lấy min-content nên một lý do dài không
    // dấu cách làm cả banner (và trang) rộng bằng chuỗi — `break-words` không thu nhỏ min-content (rules/frontend.md mục 5).
    <Alert variant={alert.variant} className="grid-cols-1">
      <p>{t(alert.messageKey)}</p>
      {reason ? (
        <p className="mt-1 font-medium break-words">
          {reason === SHOP_CASCADE_SUSPEND_REASON
            ? t('shopStatusReasonOwnerSuspended')
            : t('shopStatusReason', { reason })}
        </p>
      ) : null}
      {showsSupport ? (
        <p className="mt-1 break-words">
          {t('shopSupportLabel')}:{' '}
          <a href={`mailto:${supportEmail}`} className="font-medium underline underline-offset-2">
            {supportEmail}
          </a>
        </p>
      ) : null}
    </Alert>
  );
}
