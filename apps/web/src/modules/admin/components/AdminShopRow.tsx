'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_SHOP_STATUS_DISPLAY } from '../admin-status-display';
import { useFormatAdminDate } from '../hooks/useFormatAdminDate';
import type { AdminShop } from '../types';
import {
  ADMIN_SHOP_FIELD_LABEL_CLASS,
  ADMIN_SHOP_GRID_CLASS,
  ADMIN_SHOP_ROW_CLASS,
} from './admin-shop-row.constants';
import { AdminShopStatusBadge } from './AdminShopStatusBadge';
import { ShopLogo } from './ShopLogo';

interface AdminShopRowProps {
  shop: AdminShop;
  // Nút hành động (AdminShopActions) do Container truyền vào — dòng không biết mutation nào.
  actions?: ReactNode;
}

// 1 dòng shop trong bảng duyệt: shop (logo + tên + slug), chủ shop (tên + email để Admin biết liên hệ
// ai), ngày tạo, trạng thái (kèm lý do từ chối/khoá nếu có), thao tác. MỘT markup CSS Grid duy nhất:
// từ `md` là hàng của bảng (cùng template cột với AdminShopListHeader), dưới `md` là thẻ xếp dọc
// với nhãn từng trường. Render <li>: nơi dùng phải bọc trong <ul>. Component THUẦN trình bày; mọi
// chuỗi do chủ shop nhập (tên, slug, lý do) hiện dạng text (React tự escape).
export function AdminShopRow({ shop, actions }: AdminShopRowProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatAdminDate();
  // Shop đang ở hàng chờ mà từng bị từ chối = shop NỘP LẠI: Admin cần thấy lần trước bị từ chối vì gì. Shop
  // REJECTED đã hiện lý do hiện tại (statusReason) ngay dưới nên không lặp lại ở đây.
  const showPreviousRejection = shop.status === 'PENDING' && shop.lastRejectionReason !== null;
  const showResubmissionCount =
    (shop.status === 'PENDING' || shop.status === 'REJECTED') && shop.resubmissionCount > 0;

  return (
    <li className={cn(ADMIN_SHOP_GRID_CLASS, ADMIN_SHOP_ROW_CLASS)}>
      <div className="flex min-w-0 items-center gap-3">
        <ShopLogo src={shop.logoUrl} />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold text-foreground">{shop.name}</h2>
          <p className="truncate text-xs text-muted-foreground">/{shop.slug}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <span className={ADMIN_SHOP_FIELD_LABEL_CLASS}>{t('columnOwner')}</span>
        <span className="truncate text-sm text-foreground">{shop.owner.name}</span>
        <span className="truncate text-xs text-muted-foreground">{shop.owner.email}</span>
      </div>

      <div className="flex flex-col">
        <span className={ADMIN_SHOP_FIELD_LABEL_CLASS}>
          {tDynamic(ADMIN_SHOP_STATUS_DISPLAY[shop.status].dateLabelKey)}
        </span>
        {/* Mốc VÀO trạng thái hiện tại (cùng khoá sắp xếp của tab); ngày tạo shop ở tooltip. */}
        <time
          dateTime={shop.statusChangedAt}
          title={t('createdAtTooltip', { date: formatDate(shop.createdAt) })}
          className="text-sm text-foreground"
        >
          {formatDate(shop.statusChangedAt)}
        </time>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className={ADMIN_SHOP_FIELD_LABEL_CLASS}>{t('columnStatus')}</span>
        <AdminShopStatusBadge status={shop.status} />
        {shop.statusReason ? (
          // Lý do tối đa 500 ký tự — kẹp 2 dòng cho bảng gọn, đủ nội dung ở `title` khi rê chuột.
          <p
            title={shop.statusReason}
            className="line-clamp-2 text-xs break-words text-muted-foreground"
          >
            {t('rowReason', { reason: shop.statusReason })}
          </p>
        ) : null}
        {showPreviousRejection ? (
          <p
            title={shop.lastRejectionReason ?? undefined}
            className="line-clamp-2 text-xs break-words text-muted-foreground"
          >
            {t('rowPreviousRejection', { reason: shop.lastRejectionReason ?? '' })}
          </p>
        ) : null}
        {showResubmissionCount ? (
          <p className="text-xs text-muted-foreground">
            {t('rowResubmitted', { count: shop.resubmissionCount })}
          </p>
        ) : null}
      </div>

      {/* `empty:hidden`: shop không còn hành động nào (đã bị từ chối) thì ô trống không chiếm chỗ. */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden md:justify-end">{actions}</div>
    </li>
  );
}
