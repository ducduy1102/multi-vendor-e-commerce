'use client';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';

// Nhãn "Quản trị viên" cạnh tên: Admin vẫn hiện trong danh sách nhưng không có nút khoá/cấm (xem getAdminUserActions), nên
// nhãn này là lời giải thích vì sao dòng không có hành động.
export function AdminUserRoleBadge() {
  const t = useTranslations('admin');

  return (
    <Badge variant="secondary">
      <ShieldCheck aria-hidden="true" data-icon="inline-start" />
      {t('usersAdminBadge')}
    </Badge>
  );
}
