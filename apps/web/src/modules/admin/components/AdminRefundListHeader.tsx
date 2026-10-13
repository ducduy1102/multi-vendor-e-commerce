'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { AdminRefundTab } from '../admin-refunds-href';
import { ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_HEADER_CLASS } from './admin-refund-row.constants';

// Nhãn 4 cột của từng bảng (cùng lưới, khác chữ): khiếu nại = yêu cầu | đơn | trạng thái | thao tác; sổ cái =
// khoản hoàn | thanh toán/đơn | trạng thái | thao tác; thanh toán bất thường = thanh toán | các đơn của lần đặt |
// vì sao bất thường | thao tác.
export const ADMIN_REFUND_COLUMN_KEYS: Record<
  AdminRefundTab,
  readonly [string, string, string, string]
> = {
  disputes: [
    'refundsColumnRequest',
    'refundsColumnOrder',
    'refundsColumnStatus',
    'refundsColumnActions',
  ],
  failed: [
    'refundsColumnRefund',
    'refundsColumnPayment',
    'refundsColumnStatus',
    'refundsColumnActions',
  ],
  payments: [
    'refundsColumnPayment',
    'refundsColumnOrders',
    'refundsColumnAbnormal',
    'refundsColumnActions',
  ],
};

interface AdminRefundListHeaderProps {
  tab: AdminRefundTab;
}

// Dòng tiêu đề của bảng — chỉ từ `md` (dưới đó mỗi dòng tự có nhãn từng trường). `aria-hidden` vì mỗi ô của dòng
// dữ liệu đã có nhãn riêng cho trình đọc màn hình (`md:sr-only`); để dòng này cũng đọc ra sẽ nhắc nhãn 2 lần. Dùng
// chung cả ở bảng thật lẫn skeleton để cột không nhảy khi dữ liệu về.
export function AdminRefundListHeader({ tab }: AdminRefundListHeaderProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const [first, second, third, last] = ADMIN_REFUND_COLUMN_KEYS[tab];

  return (
    <div aria-hidden="true" className={cn(ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_HEADER_CLASS)}>
      <span>{tDynamic(first)}</span>
      <span>{tDynamic(second)}</span>
      <span>{tDynamic(third)}</span>
      <span className="md:text-right">{tDynamic(last)}</span>
    </div>
  );
}
