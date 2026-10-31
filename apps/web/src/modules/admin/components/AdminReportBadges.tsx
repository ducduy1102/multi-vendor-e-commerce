'use client';

import { Clock, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';

import { TONE_STYLE } from './AdminShopStatusBadge';

// Huy hiệu "+N người khác": N người KHÁC cũng đang báo cáo cùng đối tượng — tín hiệu mức nghiêm trọng, và cũng là số báo cáo sẽ đóng cùng
// khi xử lý báo cáo này. Không vẽ gì khi N = 0.
export function AdminReportOthersBadge({ count }: { count: number }) {
  const t = useTranslations('admin');
  if (count <= 0) return null;

  return (
    <Badge variant="secondary">
      <Users aria-hidden="true" />
      {t('reportsOthers', { count })}
    </Badge>
  );
}

// Nhãn "Chờ lâu" cho báo cáo mở từ 48 giờ (isAdminReportSlow). `title` giải thích mốc vì chữ "lâu" tự nó không nói bao lâu.
export function AdminReportSlowBadge() {
  const t = useTranslations('admin');

  return (
    <Badge
      variant={TONE_STYLE.warning.variant}
      className={TONE_STYLE.warning.className}
      title={t('reportsSlowTitle')}
    >
      <Clock aria-hidden="true" />
      {t('reportsSlow')}
    </Badge>
  );
}
