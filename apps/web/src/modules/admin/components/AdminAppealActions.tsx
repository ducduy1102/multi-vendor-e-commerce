'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import { ADMIN_CAUTION_BUTTON_CLASS } from './admin-caution-button.constants';
import {
  ADMIN_APPEAL_ACTION_BUTTON_CLASS,
  ADMIN_APPEAL_ACTIONS_CLASS,
} from './admin-appeal-row.constants';

interface AdminAppealActionsProps {
  // Tên đối tượng (shop hoặc sản phẩm) — chỉ để gắn vào `aria-label` ("Chấp nhận: Shop A"): trên một trang có nhiều nút giống hệt nhau,
  // trình đọc màn hình cần biết nút nào của đối tượng nào.
  targetName: string;
  // Khoá mọi nút khi một hành động đang chạy (tránh gửi trùng / hai hành động chồng nhau).
  isDisabled: boolean;
  onAccept: () => void;
  onReject: () => void;
}

// Component THUẦN: hai quyết định của một kháng nghị ĐANG CHỜ (dòng đã quyết định / đã đóng không render component này). "Chấp
// nhận" (mở khoá shop / khôi phục sản phẩm) là hành động chính — nút đặc, đứng trên; "Từ chối" là nút viền + chữ đỏ (ADMIN_CAUTION_BUTTON_CLASS) như
// "Từ chối" của hàng chờ duyệt shop. Cả hai đều mở hộp thoại ở Container. Bố cục cột ở admin-appeal-row.constants.ts.
export function AdminAppealActions({
  targetName,
  isDisabled,
  onAccept,
  onReject,
}: AdminAppealActionsProps) {
  const t = useTranslations('admin');
  const acceptLabel = t('appealsAccept');
  const rejectLabel = t('appealsReject');

  return (
    <div className={ADMIN_APPEAL_ACTIONS_CLASS}>
      <Button
        type="button"
        className={ADMIN_APPEAL_ACTION_BUTTON_CLASS}
        disabled={isDisabled}
        aria-label={t('actionLabelWithShop', { action: acceptLabel, name: targetName })}
        onClick={onAccept}
      >
        {acceptLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(ADMIN_APPEAL_ACTION_BUTTON_CLASS, ADMIN_CAUTION_BUTTON_CLASS)}
        disabled={isDisabled}
        aria-label={t('actionLabelWithShop', { action: rejectLabel, name: targetName })}
        onClick={onReject}
      >
        {rejectLabel}
      </Button>
    </div>
  );
}
