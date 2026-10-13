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
import type { SellerRefundRequest } from '../types';
import { DetailSection } from './OrderDetailSections';
import { RefundRequestStatusBadge } from './RefundRequestStatusBadge';
import { SellerRefundDeadline } from './SellerRefundDeadline';
import { TimelineSteps } from './TimelineSteps';

interface SellerRefundRequestCardProps {
  request: SellerRefundRequest;
  // Khoá hai nút khi một hành động đang chạy (tránh gửi trùng/2 hành động chồng nhau).
  isDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}

// Thẻ yêu cầu hủy/trả hàng của người mua ở chi tiết đơn của SHOP — component THUẦN từ `SellerRefundRequest`:
//   - trạng thái hiện tại (huy hiệu) + hạn phản hồi và hệ quả nếu để quá hạn, khi còn chờ shop;
//   - lý do và mô tả của người mua (shop cần đọc để quyết định);
//   - dòng thời gian dựng từ `history`, mới nhất lên đầu, kể theo góc nhìn của shop ("Bạn đã từ chối…");
//   - nút "Chấp thuận" / "Từ chối" CHỈ theo hai cờ `canApprove`/`canReject` do BE tính (bảng chuyển có actor:
//     yêu cầu hủy đã lên sàn vẫn chấp thuận được — shop nhượng bộ; yêu cầu trả hàng đã lên sàn thì do sàn quyết).
// Hộp thoại xác nhận (duyệt nhắc kho nếu là trả hàng; từ chối bắt buộc ghi chú) và mutation nằm ở Container.
// Mọi khối chữ do người mua/shop/sàn nhập dùng lưới `grid-cols-1` và `break-words` để chuỗi dài không dấu cách
// không đẩy trang rộng ra (rules/frontend.md mục 5).
export function SellerRefundRequestCard({
  request,
  isDisabled,
  onApprove,
  onReject,
}: SellerRefundRequestCardProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();
  const steps = sortRefundHistoryNewestFirst(request.history).map((step) => {
    const { labelKey, showNote, noteKey } = describeRefundRequestEntry(step, 'seller');
    return {
      id: `${step.createdAt}-${step.toStatus}-${step.actorType}`,
      label: tDynamic(labelKey),
      createdAt: step.createdAt,
      formattedDate: formatDate(step.createdAt),
      note: showNote && step.note ? tDynamic(noteKey, { reason: step.note }) : null,
    };
  });
  const hasActions = request.canApprove || request.canReject;

  return (
    <DetailSection title={tDynamic(REFUND_REQUEST_TITLE_KEYS[request.kind])}>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-1.5">
          <div>
            <RefundRequestStatusBadge status={request.status} />
          </div>
          {request.status === 'PENDING_SELLER' ? (
            <SellerRefundDeadline kind={request.kind} respondBy={request.sellerRespondBy} />
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-1">
          <p className="text-sm break-words text-foreground">
            {t('refundBuyerReason', {
              reason: tDynamic(getRefundReasonLabelKey(request.reasonCode)),
            })}
          </p>
          {request.reasonNote ? (
            <p className="text-sm break-words whitespace-pre-line text-muted-foreground">
              {t('refundBuyerNote', { note: request.reasonNote })}
            </p>
          ) : null}
        </div>

        {request.status === 'ESCALATED' ? (
          <p className="text-xs text-muted-foreground">
            {t('refundSellerEscalatedHint')}
            {request.canApprove ? ` ${t('refundSellerConcedeHint')}` : ''}
          </p>
        ) : null}

        {hasActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {request.canApprove ? (
              <Button type="button" className="min-h-9" disabled={isDisabled} onClick={onApprove}>
                {t('actionApproveRequest')}
              </Button>
            ) : null}
            {request.canReject ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-9"
                disabled={isDisabled}
                onClick={onReject}
              >
                {t('actionRejectRequest')}
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
