'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_HEADER_CLASS } from './admin-shop-row.constants';

// Dòng tiêu đề của bảng — chỉ từ `md` (dưới đó mỗi dòng tự có nhãn từng trường). `aria-hidden` vì
// mỗi ô của dòng dữ liệu đã có nhãn riêng cho trình đọc màn hình (`md:sr-only`); để dòng này cũng
// đọc ra sẽ nhắc nhãn 2 lần. Dùng chung cả ở bảng thật lẫn skeleton để cột không nhảy khi dữ liệu về.
export function AdminShopListHeader() {
  const t = useTranslations('admin');

  return (
    <div aria-hidden="true" className={cn(ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_HEADER_CLASS)}>
      <span>{t('columnShop')}</span>
      <span>{t('columnOwner')}</span>
      <span>{t('columnCreatedAt')}</span>
      <span>{t('columnStatus')}</span>
      <span className="md:text-right">{t('columnActions')}</span>
    </div>
  );
}
