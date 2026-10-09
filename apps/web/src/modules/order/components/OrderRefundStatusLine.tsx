'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { REFUND_REQUEST_TITLE_KEYS } from '../refund-request-display';
import type { OrderListItem } from '../types';
import { RefundRequestStatusBadge } from './RefundRequestStatusBadge';

interface OrderRefundStatusLineProps {
  request: OrderListItem['refundRequest'];
}

// Dòng gọn về yêu cầu hủy/trả hàng đang có, đặt ở chân card trong DANH SÁCH đơn: khi đã có yêu cầu thì cờ
// `canRequestCancel`/`canRequestReturn` tắt nên card không còn nút nào — thiếu dòng này người mua thấy đơn "không
// có gì xảy ra". Chi tiết (hạn phản hồi, dòng thời gian, rút/khiếu nại) ở trang chi tiết đơn. Không có yêu cầu
// thì không render gì.
export function OrderRefundStatusLine({ request }: OrderRefundStatusLineProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;

  if (!request) {
    return null;
  }

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{tDynamic(REFUND_REQUEST_TITLE_KEYS[request.kind])}</span>
      <RefundRequestStatusBadge status={request.status} />
    </p>
  );
}
