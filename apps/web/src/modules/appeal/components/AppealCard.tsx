'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/shared/components/ui/badge';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { APPEAL_BADGE_CLASS, APPEAL_STATE_DISPLAY } from '../appeal-display';
import { useFormatAppealDateTime } from '../hooks/useFormatAppealDateTime';
import type { OwnerAppeal } from '../types';

interface AppealCardProps {
  appeal: OwnerAppeal;
}

// MỘT kháng nghị trong lịch sử của shop: trạng thái, lời đã gửi, và (khi Admin đã quyết định) phản hồi từ sàn. Cả lời kháng
// nghị lẫn phản hồi là văn bản tự do nên hiện dạng text (React tự escape), xuống dòng được giữ, chuỗi dài không dấu cách bị bẻ
// (`[overflow-wrap:anywhere]` — `break-words` không thu nhỏ min-content, xem rules/frontend.md mục 5). Chủ shop KHÔNG thấy Admin
// nào quyết định — chỉ thấy "sàn" phản hồi. Component THUẦN trình bày.
export function AppealCard({ appeal }: AppealCardProps) {
  const t = useTranslations('appeal');
  const tDynamic = t as unknown as LooseTranslator;
  const formatDateTime = useFormatAppealDateTime();
  const display = APPEAL_STATE_DISPLAY[appeal.state];
  const style = APPEAL_BADGE_CLASS[display.tone];

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Badge variant={style.variant} className={cn(style.className)}>
          {tDynamic(display.labelKey)}
        </Badge>
        <time dateTime={appeal.createdAt} className="text-xs text-muted-foreground">
          {t('sentAt', { date: formatDateTime(appeal.createdAt) })}
        </time>
      </div>

      <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">
        {appeal.message}
      </p>

      {appeal.decisionNote ? (
        <div className="flex min-w-0 flex-col gap-0.5 border-l-2 border-border pl-3">
          <span className="text-xs font-medium text-muted-foreground">
            {t('decisionNoteLabel')}
          </span>
          <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">
            {appeal.decisionNote}
          </p>
        </div>
      ) : null}

      {appeal.decidedAt ? (
        <time dateTime={appeal.decidedAt} className="text-xs text-muted-foreground">
          {t('decidedAt', { date: formatDateTime(appeal.decidedAt) })}
        </time>
      ) : null}

      {appeal.state === 'CLOSED' ? (
        <p className="text-xs text-muted-foreground">{t('closedHint')}</p>
      ) : null}
    </li>
  );
}
