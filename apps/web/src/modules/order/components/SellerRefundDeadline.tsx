'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { REFUND_SELLER_OVERDUE_KEYS } from '../refund-request-display';
import type { RefundRequestKind } from '../types';

interface SellerRefundDeadlineProps {
  kind: RefundRequestKind;
  // Hạn shop phản hồi (ISO, từ BE).
  respondBy: string;
}

// Hạn shop phải phản hồi yêu cầu + hệ quả nếu im lặng (hủy ⇒ đơn tự hủy, trả hàng ⇒ chuyển lên sàn) — shop cần
// biết CẢ HAI thì mới quyết định kịp. Chỉ hiện khi yêu cầu còn chờ shop (nơi gọi quyết định). Hạn hiển thị theo
// giờ trình duyệt, kèm giờ phút. Không tự tính "còn bao lâu"/"đã quá hạn": phụ thuộc đồng hồ máy người dùng và
// việc quá hạn do hệ thống xử lý (BE đổi trạng thái), nên chỉ nêu mốc chứ không suy diễn.
export function SellerRefundDeadline({ kind, respondBy }: SellerRefundDeadlineProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();

  return (
    <p className="grid grid-cols-1 gap-0.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {t('refundSellerRespondBy', { date: formatDate(respondBy) })}
      </span>
      <span>{tDynamic(REFUND_SELLER_OVERDUE_KEYS[kind])}</span>
    </p>
  );
}
