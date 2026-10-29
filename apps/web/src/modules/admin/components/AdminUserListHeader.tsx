'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_GRID_CLASS, ADMIN_USER_HEADER_CLASS } from './admin-user-row.constants';

// Dòng tiêu đề của bảng — chỉ từ `md` (dưới đó mỗi dòng là thẻ). `aria-hidden` vì mỗi ô của dòng dữ liệu đã có nhãn riêng cho
// trình đọc màn hình; để dòng này cũng đọc ra sẽ nhắc nhãn hai lần. Dùng chung cả ở bảng thật lẫn skeleton để cột không nhảy
// khi dữ liệu về.
export function AdminUserListHeader() {
  const t = useTranslations('admin');

  return (
    <div aria-hidden="true" className={cn(ADMIN_USER_GRID_CLASS, ADMIN_USER_HEADER_CLASS)}>
      <span>{t('usersColumnUser')}</span>
      <span>{t('columnStatus')}</span>
      <span>{t('usersColumnDate')}</span>
      <span className="md:text-right">{t('columnActions')}</span>
    </div>
  );
}
