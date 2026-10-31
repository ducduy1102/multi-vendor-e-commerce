'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';

import { ADMIN_APPEAL_GRID_CLASS, ADMIN_APPEAL_HEADER_CLASS } from './admin-appeal-row.constants';

// Dòng tiêu đề của bảng kháng nghị — chỉ từ `lg` (dưới đó mỗi dòng tự có nhãn từng trường). `aria-hidden` vì mỗi ô của dòng dữ liệu
// đã có nhãn riêng cho trình đọc màn hình (`lg:sr-only`); để dòng này cũng đọc ra sẽ nhắc nhãn hai lần. Dùng chung cả ở bảng thật
// lẫn skeleton để cột không nhảy khi dữ liệu về.
export function AdminAppealListHeader() {
  const t = useTranslations('admin');

  return (
    <div aria-hidden="true" className={cn(ADMIN_APPEAL_GRID_CLASS, ADMIN_APPEAL_HEADER_CLASS)}>
      <span>{t('appealsColumnTarget')}</span>
      <span>{t('appealsColumnMessage')}</span>
      <span>{t('appealsColumnSentAt')}</span>
      <span>{t('columnStatus')}</span>
      <span className="lg:text-right">{t('columnActions')}</span>
    </div>
  );
}
