'use client';

import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { useFormatOrderDate } from '../hooks/useFormatOrderDate';
import {
  describeTimelineEntry,
  sortTimelineNewestFirst,
  type TimelineViewer,
} from '../order-timeline';
import type { OrderHistoryEntry } from '../types';

interface OrderTimelineProps {
  // Thứ tự BE trả: cũ → mới (dòng đầu fromStatus = null). Component tự đảo để hiện mới nhất lên đầu.
  history: readonly OrderHistoryEntry[];
  // Người đọc — quyết định cách gọi khi người MUA hủy đơn. Mặc định là người mua.
  viewer?: TimelineViewer;
}

// Timeline THUẦN từ `history` (OrderStatusHistory — nguồn sự thật duy nhất của lịch sử đơn). Không
// có tiêu đề riêng: nơi dùng bọc trong <section> có heading. Bước mới nhất được nhấn (chấm primary,
// chữ đậm, aria-current="step"); chỉ hiện `note` khi shop từ chối đơn (xem describeTimelineEntry).
export function OrderTimeline({ history, viewer = 'buyer' }: OrderTimelineProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDate = useFormatOrderDate();
  const steps = sortTimelineNewestFirst(history);

  if (steps.length === 0) {
    return null;
  }

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const { labelKey, showNote } = describeTimelineEntry(step, viewer);
        const isCurrent = index === 0;
        const isLast = index === steps.length - 1;

        return (
          <li
            key={`${step.createdAt}-${step.fromStatus ?? 'start'}-${step.toStatus}`}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-0 left-[5px] w-px bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-1 size-[11px] shrink-0 rounded-full border-2',
                isCurrent ? 'border-primary bg-primary' : 'border-border bg-background',
              )}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'text-sm',
                  isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {tDynamic(labelKey)}
              </span>
              <time dateTime={step.createdAt} className="text-xs text-muted-foreground">
                {formatDate(step.createdAt)}
              </time>
              {showNote && step.note ? (
                <span className="text-sm break-words text-foreground">
                  {t('timelineReason', { reason: step.note })}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
