'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import {
  describeTimelineEntry,
  sortTimelineNewestFirst,
  type TimelineViewer,
} from '../order-timeline';
import type { OrderHistoryEntry } from '../types';
import { TimelineSteps } from './TimelineSteps';

interface OrderTimelineProps {
  // Thứ tự BE trả: cũ → mới (dòng đầu fromStatus = null). Component tự đảo để hiện mới nhất lên đầu.
  history: readonly OrderHistoryEntry[];
  // Người đọc — quyết định cách gọi khi người MUA hủy đơn. Mặc định là người mua.
  viewer?: TimelineViewer;
}

// Timeline THUẦN từ `history` (OrderStatusHistory — nguồn sự thật duy nhất của lịch sử đơn). Không
// có tiêu đề riêng: nơi dùng bọc trong <section> có heading. Chỉ hiện `note` khi đơn bị shop từ chối hoặc người
// mua hủy kèm lý do (xem describeTimelineEntry). Phần vẽ nằm ở TimelineSteps (dùng chung với thẻ yêu cầu
// hủy/trả hàng); ở đây chỉ dịch nhãn, định dạng ngày và quyết định bước nào có ghi chú.
export function OrderTimeline({ history, viewer = 'buyer' }: OrderTimelineProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();

  const steps = sortTimelineNewestFirst(history).map((step) => {
    const { labelKey, showNote, noteKey } = describeTimelineEntry(step, viewer);
    return {
      id: `${step.createdAt}-${step.fromStatus ?? 'start'}-${step.toStatus}`,
      label: tDynamic(labelKey),
      createdAt: step.createdAt,
      formattedDate: formatDate(step.createdAt),
      note: showNote && step.note ? tDynamic(noteKey, { reason: step.note }) : null,
    };
  });

  return <TimelineSteps steps={steps} />;
}
