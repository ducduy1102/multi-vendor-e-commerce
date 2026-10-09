'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { AdminShopBadgeTone } from '../admin-status-display';
import { TONE_STYLE } from './AdminShopStatusBadge';

interface AdminToneBadgeProps {
  // Key i18n (namespace `admin`) + sắc thái — lấy từ các bảng *_DISPLAY của admin-refund-display.ts.
  display: { labelKey: string; tone: AdminShopBadgeTone };
  className?: string;
}

// Huy hiệu trạng thái dùng chung cho mọi thực thể của khu hoàn tiền (yêu cầu, khoản hoàn, loại thanh toán bất
// thường): cùng bộ tông màu ngữ nghĩa với AdminShopStatusBadge (không accent). Nhãn tra theo enum lúc chạy:
// admin-refund-display.test.ts kiểm mọi giá trị đều có bản dịch.
export function AdminToneBadge({ display, className }: AdminToneBadgeProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const style = TONE_STYLE[display.tone];

  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      {tDynamic(display.labelKey)}
    </Badge>
  );
}
