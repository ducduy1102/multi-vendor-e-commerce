'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import { REFUND_REQUEST_TITLE_KEYS, getRefundReasonLabelKey } from '../refund-request-display';
import {
  describeRefundRequestEntry,
  sortRefundHistoryNewestFirst,
} from '../refund-request-timeline';
import type { BuyerRefundRequest } from '../types';
import { DetailSection } from './OrderDetailSections';
import { RefundRequestStatusBadge } from './RefundRequestStatusBadge';
import { TimelineSteps } from './TimelineSteps';

interface RefundRequestCardProps {
  request: BuyerRefundRequest;
  // Khoá hai nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onWithdraw: () => void;
  onEscalate: () => void;
}

// Thẻ yêu cầu hủy/trả hàng ở chi tiết đơn của NGƯỜI MUA — component THUẦN từ `BuyerRefundRequest`:
//   - trạng thái hiện tại (huy hiệu) + hạn shop phản hồi khi đang chờ shop;
//   - lý do và mô tả của chính người mua;
//   - dòng thời gian dựng từ `history` (không suy ngược từ cột nào), mới nhất lên đầu — kèm lý do từ chối của
//     shop/sàn ở đúng bước đó;
//   - nút "Rút yêu cầu" (shop chưa trả lời) và "Khiếu nại với sàn" (shop đã từ chối, còn hạn) CHỈ theo hai cờ
//     `canWithdraw`/`canEscalate` do BE tính — FE không tự suy cửa sổ khiếu nại.
// Hộp thoại xác nhận và mutation nằm ở Container. Mọi khối chữ do người dùng/shop/sàn nhập (lý do, mô tả,
// ghi chú) dùng lưới `grid-cols-1` và `break-words`, chuỗi dài không dấu cách không đẩy trang rộng ra
// (rules/frontend.md mục 5). Dòng thời gian vẽ bằng TimelineSteps, dùng chung với OrderTimeline.
export function RefundRequestCard({
  request,
  isDisabled,
  onWithdraw,
  onEscalate,
}: RefundRequestCardProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();
  const steps = sortRefundHistoryNewestFirst(request.history).map((step) => {
    const { labelKey, showNote, noteKey } = describeRefundRequestEntry(step);
    return {
      id: `${step.createdAt}-${step.toStatus}-${step.actorType}`,
      label: tDynamic(labelKey),
      createdAt: step.createdAt,
      formattedDate: formatDate(step.createdAt),
      note: showNote && step.note ? tDynamic(noteKey, { reason: step.note }) : null,
    };
  });
  const hasActions = request.canWithdraw || request.canEscalate;

  return (
    <DetailSection title={tDynamic(REFUND_REQUEST_TITLE_KEYS[request.kind])}>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RefundRequestStatusBadge status={request.status} />
          {request.status === 'PENDING_SELLER' ? (
            <span className="text-xs text-muted-foreground">
              {t('refundRespondBy', { date: formatDate(request.sellerRespondBy) })}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-1">
          <p className="text-sm break-words text-foreground">
            {t('refundYourReason', {
              reason: tDynamic(getRefundReasonLabelKey(request.reasonCode)),
            })}
          </p>
          {request.reasonNote ? (
            <p className="text-sm break-words whitespace-pre-line text-muted-foreground">
              {t('refundYourNote', { note: request.reasonNote })}
            </p>
          ) : null}
        </div>

        {request.canEscalate ? (
          <p className="text-xs text-muted-foreground">{t('refundEscalateHint')}</p>
        ) : null}

        {hasActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {request.canEscalate ? (
              <Button type="button" className="min-h-9" disabled={isDisabled} onClick={onEscalate}>
                {t('actionEscalate')}
              </Button>
            ) : null}
            {request.canWithdraw ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-9"
                disabled={isDisabled}
                onClick={onWithdraw}
              >
                {t('actionWithdrawRequest')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 border-t border-border pt-3">
            <h3 className="text-xs font-semibold text-muted-foreground">
              {t('refundTimelineTitle')}
            </h3>
            <TimelineSteps steps={steps} />
          </div>
        ) : null}
      </div>
    </DetailSection>
  );
}
