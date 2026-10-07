'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ORDER_STATUS_DISPLAY, type OrderBadgeTone } from '../order-status-display';
import type { OrderStatus } from '../types';

// Chỉ semantic color. Chữ của `warning` dùng foreground (không dùng chính màu amber làm màu chữ —
// amber trên nền sáng không đủ tương phản ở cỡ chữ 12px), `warning` chỉ làm nền/viền nhạt.
const TONE_STYLE: Record<
  OrderBadgeTone,
  { variant: 'default' | 'secondary' | 'outline'; className: string }
> = {
  warning: { variant: 'outline', className: 'border-warning/40 bg-warning/15 text-foreground' },
  neutral: { variant: 'secondary', className: '' },
  primary: { variant: 'default', className: '' },
  success: { variant: 'outline', className: 'border-success/30 bg-success/10 text-success' },
  muted: { variant: 'outline', className: 'text-muted-foreground' },
};

interface OrderStatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps) {
  const t = useTranslations('order');
  // Key tra theo enum lúc chạy nên next-intl không suy được kiểu key hẹp — cùng namespace nên chỉ
  // cần ép về LooseTranslator (order-status-display.test.ts kiểm mọi key đều có bản dịch).
  const tDynamic = t as unknown as LooseTranslator;
  const display = ORDER_STATUS_DISPLAY[status];
  const style = TONE_STYLE[display.tone];

  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {tDynamic(display.labelKey)}
    </Badge>
  );
}
