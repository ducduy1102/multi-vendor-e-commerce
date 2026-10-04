'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_STATUS_DISPLAY } from '../admin-status-display';
import type { ShopStatus } from '../types';
import { ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_HEADER_CLASS } from './admin-shop-row.constants';

interface AdminShopListHeaderProps {
  // Tab đang xem — quyết định nhãn cột ngày ("Chờ từ", "Duyệt lúc"...).
  status: ShopStatus;
}

// Dòng tiêu đề của bảng — chỉ từ `md` (dưới đó mỗi dòng tự có nhãn từng trường). `aria-hidden` vì
// mỗi ô của dòng dữ liệu đã có nhãn riêng cho trình đọc màn hình (`md:sr-only`); để dòng này cũng
// đọc ra sẽ nhắc nhãn 2 lần. Dùng chung cả ở bảng thật lẫn skeleton để cột không nhảy khi dữ liệu về.
export function AdminShopListHeader({ status }: AdminShopListHeaderProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <div aria-hidden="true" className={cn(ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_HEADER_CLASS)}>
      <span>{t('columnShop')}</span>
      <span>{t('columnOwner')}</span>
      <span>{tDynamic(ADMIN_SHOP_STATUS_DISPLAY[status].dateLabelKey)}</span>
      <span>{t('columnStatus')}</span>
      <span className="md:text-right">{t('columnActions')}</span>
    </div>
  );
}
