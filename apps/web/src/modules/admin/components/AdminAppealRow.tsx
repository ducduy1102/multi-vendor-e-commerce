'use client';

import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/utils';

import { ADMIN_APPEAL_STATE_DISPLAY } from '../admin-appeal-display';
import { useFormatAdminDate } from '../hooks/useFormatAdminDate';
import { useFormatAdminDateTime } from '../hooks/useFormatAdminDateTime';
import type { AdminAppeal } from '../types';
import {
  ADMIN_APPEAL_FIELD_LABEL_CLASS,
  ADMIN_APPEAL_FULL_ROW_CELL_CLASS,
  ADMIN_APPEAL_GRID_CLASS,
  ADMIN_APPEAL_ROW_CLASS,
} from './admin-appeal-row.constants';
import { AdminToneBadge } from './AdminToneBadge';
import { ShopLogo } from './ShopLogo';

interface AdminAppealRowProps {
  appeal: AdminAppeal;
  // Nút hành động (AdminAppealActions) do Container truyền vào — dòng không biết mutation nào. Chỉ có ở kháng nghị đang chờ.
  actions?: ReactNode;
}

// MỘT dòng kháng nghị trong bảng (cả kháng nghị shop bị khoá lẫn kháng nghị sản phẩm bị gỡ, Week11.md 5.8): đối tượng (logo shop + tên +
// chủ shop để Admin biết liên hệ ai; với sản phẩm là tên sản phẩm kèm tên shop), lời kháng nghị (kèm lý do đã khoá shop / gỡ sản phẩm),
// ngày gửi, trạng thái (kèm ghi chú / người quyết định khi đã có kết quả), thao tác. MỘT markup CSS Grid duy nhất: từ `lg` là hàng
// của bảng (cùng template cột với AdminAppealListHeader), dưới `lg` là thẻ xếp dọc với nhãn từng trường. Render <li>: nơi dùng
// phải bọc trong <ul>. Component THUẦN trình bày; mọi chuỗi do chủ shop / Admin nhập (tên, lời kháng nghị, lý do, ghi chú) hiện dạng
// text (React tự escape) và bẻ chuỗi dài không dấu cách (`[overflow-wrap:anywhere]`, rules/frontend.md mục 5). Chữ bị cắt
// (line-clamp / truncate) luôn có `title` mang bản đầy đủ.
export function AdminAppealRow({ appeal, actions }: AdminAppealRowProps) {
  const t = useTranslations('admin');
  const formatDate = useFormatAdminDate();
  const formatDateTime = useFormatAdminDateTime();
  const { shop, owner } = appeal;
  // Kháng nghị sản phẩm luôn có khối `product` (BE bỏ kháng nghị mà sản phẩm không còn); thiếu thì rơi về dạng shop.
  const product = appeal.targetType === 'PRODUCT' ? appeal.product : null;
  const targetName = product ? product.name : shop.name;
  const stateDisplay = ADMIN_APPEAL_STATE_DISPLAY[appeal.state];
  // Lần khoá do Admin thực hiện nên lý do là văn bản; nhưng shop có thể bị khoá lại theo cascade SAU khi kháng nghị đã đóng — khi đó BE
  // lưu MÃ (SHOP_CASCADE_SUSPEND_REASON), FE dịch ra câu theo ngôn ngữ, mã thô không bao giờ hiện cho người xem.
  // Với kháng nghị sản phẩm thì lý do hiện ra là lý do GỠ SẢN PHẨM (trạng thái shop không liên quan tới kháng nghị này).
  const moderationReasonText = product ? product.takenDownReason : shop.statusReason;
  const moderationReason = moderationReasonText
    ? product
      ? t('appealsRowRemovalReason', { reason: moderationReasonText })
      : moderationReasonText === SHOP_CASCADE_SUSPEND_REASON
        ? t('rowReasonOwnerAccountSuspended')
        : t('appealsRowSuspensionReason', { reason: moderationReasonText })
    : null;

  return (
    <li className={cn(ADMIN_APPEAL_GRID_CLASS, ADMIN_APPEAL_ROW_CLASS)}>
      <div className={cn('flex min-w-0 items-center gap-3', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}>
        <ShopLogo src={shop.logoUrl} />
        <div className="flex min-w-0 flex-col">
          {/* Nhãn loại đứng RIÊNG một dòng phía trên tên: đặt cạnh tên thì ở cột hẹp (2fr) tên sản phẩm chỉ còn vài ký tự. */}
          <Badge variant="outline" className="mb-0.5 self-start text-muted-foreground">
            {product ? t('appealsRowTypeProduct') : t('appealsRowTypeShop')}
          </Badge>
          <h2 title={targetName} className="truncate text-sm font-semibold text-foreground">
            {targetName}
          </h2>
          {product ? (
            <p title={shop.name} className="truncate text-xs text-foreground">
              {t('appealsRowOfShop', { name: shop.name })}
            </p>
          ) : (
            <p title={owner.name} className="truncate text-xs text-foreground">
              {owner.name}
            </p>
          )}
          <p title={owner.email} className="truncate text-xs text-muted-foreground">
            {owner.email}
          </p>
        </div>
      </div>

      <div className={cn('flex min-w-0 flex-col gap-1', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}>
        <span className={ADMIN_APPEAL_FIELD_LABEL_CLASS}>{t('appealsColumnMessage')}</span>
        {/* Lời kháng nghị tối đa 1.000 ký tự: kẹp 3 dòng cho bảng gọn; đủ nội dung ở `title` và trong hộp thoại quyết định. */}
        <p
          title={appeal.message}
          className="line-clamp-3 text-sm whitespace-pre-line text-foreground [overflow-wrap:anywhere]"
        >
          {appeal.message}
        </p>
        {moderationReason ? (
          <p
            title={moderationReasonText ?? undefined}
            className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]"
          >
            {moderationReason}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col">
        <span className={ADMIN_APPEAL_FIELD_LABEL_CLASS}>{t('appealsColumnSentAt')}</span>
        <time dateTime={appeal.createdAt} className="text-sm text-foreground">
          {formatDate(appeal.createdAt)}
        </time>
      </div>

      <div
        className={cn('flex min-w-0 flex-col items-start gap-1', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}
      >
        <span className={ADMIN_APPEAL_FIELD_LABEL_CLASS}>{t('columnStatus')}</span>
        <AdminToneBadge display={stateDisplay} />
        {appeal.decisionNote ? (
          <p
            title={appeal.decisionNote}
            className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]"
          >
            {t('appealsRowDecisionNote', { note: appeal.decisionNote })}
          </p>
        ) : null}
        {appeal.decidedByName ? (
          <p
            title={appeal.decidedByName}
            className="max-w-full truncate text-xs text-muted-foreground"
          >
            {t('appealsRowDecidedBy', { name: appeal.decidedByName })}
          </p>
        ) : null}
        {appeal.decidedAt ? (
          <time dateTime={appeal.decidedAt} className="text-xs text-muted-foreground">
            {t('appealsRowDecidedAt', { date: formatDateTime(appeal.decidedAt) })}
          </time>
        ) : null}
        {appeal.state === 'CLOSED' ? (
          <p className="text-xs text-muted-foreground">
            {product ? t('appealsRowClosedHintProduct') : t('appealsRowClosedHint')}
          </p>
        ) : null}
      </div>

      {/* `empty:hidden`: dòng đã quyết định / đã đóng không có hành động nên ô trống không chiếm chỗ (và không để lại khoảng cách
          ở thẻ mobile). Ô là cột flex để cụm nút bên trong tự giãn đủ bề rộng cột. */}
      <div className={cn('flex min-w-0 flex-col empty:hidden', ADMIN_APPEAL_FULL_ROW_CELL_CLASS)}>
        {actions}
      </div>
    </li>
  );
}
