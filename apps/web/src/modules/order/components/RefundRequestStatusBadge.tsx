'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { REFUND_REQUEST_STATUS_DISPLAY } from '../refund-request-display';
import type { RefundRequestStatus } from '../types';
import { TONE_STYLE } from './OrderStatusBadge';

interface RefundRequestStatusBadgeProps {
  status: RefundRequestStatus;
  className?: string;
}

// Huy hiệu trạng thái của yêu cầu hủy/trả hàng — cùng bộ tông màu ngữ nghĩa với OrderStatusBadge (không đỏ,
// không accent). Nhãn tra theo enum lúc chạy: refund-request-display.test.ts kiểm mọi trạng thái đều có bản dịch.
export function RefundRequestStatusBadge({ status, className }: RefundRequestStatusBadgeProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const display = REFUND_REQUEST_STATUS_DISPLAY[status];
  const style = TONE_STYLE[display.tone];

  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {tDynamic(display.labelKey)}
    </Badge>
  );
}
