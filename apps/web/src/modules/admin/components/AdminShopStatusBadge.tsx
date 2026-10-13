'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_STATUS_DISPLAY, type AdminShopBadgeTone } from '../admin-status-display';
import type { ShopStatus } from '../types';

// Chỉ semantic color. Chữ của `warning` dùng foreground (không dùng chính màu amber làm màu chữ —
// amber trên nền sáng không đủ tương phản ở cỡ chữ 12px), `warning` chỉ làm nền/viền nhạt.
export const TONE_STYLE: Record<
  AdminShopBadgeTone,
  { variant: 'outline' | 'destructive'; className: string }
> = {
  warning: { variant: 'outline', className: 'border-warning/40 bg-warning/15 text-foreground' },
  success: { variant: 'outline', className: 'border-success/30 bg-success/10 text-success' },
  destructive: { variant: 'destructive', className: '' },
  muted: { variant: 'outline', className: 'text-muted-foreground' },
};

interface AdminShopStatusBadgeProps {
  status: ShopStatus;
  className?: string;
}

export function AdminShopStatusBadge({ status, className }: AdminShopStatusBadgeProps) {
  const t = useTranslations('admin');
  // Key tra theo enum lúc chạy nên next-intl không suy được kiểu key hẹp — cùng namespace nên chỉ
  // cần ép về LooseTranslator (admin-status-display.test.ts kiểm mọi key đều có bản dịch).
  const tDynamic = t as unknown as LooseTranslator;
  const display = ADMIN_SHOP_STATUS_DISPLAY[status];
  const style = TONE_STYLE[display.tone];

  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {tDynamic(display.labelKey)}
    </Badge>
  );
}
