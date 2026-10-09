'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';

import {
  SELLER_REFUND_GRID_CLASS,
  SELLER_REFUND_HEADER_CLASS,
} from './seller-refund-request-row.constants';

// Dòng tiêu đề của bảng — chỉ từ `md` (dưới đó mỗi dòng tự có nhãn từng trường). `aria-hidden` vì mỗi ô của dòng
// dữ liệu đã có nhãn riêng cho trình đọc màn hình (`md:sr-only`); để dòng này cũng đọc ra sẽ nhắc nhãn 2 lần.
// Dùng chung cả ở bảng thật lẫn skeleton để cột không nhảy khi dữ liệu về.
export function SellerRefundRequestsHeader() {
  const t = useTranslations('order');

  return (
    <div aria-hidden="true" className={cn(SELLER_REFUND_GRID_CLASS, SELLER_REFUND_HEADER_CLASS)}>
      <span>{t('refundQueueColumnRequest')}</span>
      <span>{t('refundQueueColumnOrder')}</span>
      <span>{t('refundQueueColumnStatus')}</span>
      <span className="md:text-right">{t('refundQueueColumnActions')}</span>
    </div>
  );
}
