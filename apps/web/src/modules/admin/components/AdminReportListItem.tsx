'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_REPORT_TYPE_DISPLAY,
  adminReportTargetTitle,
  isAdminReportSlow,
} from '../admin-report-display';
import { buildAdminReportDetailHref } from '../admin-reports-href';
import { useFormatAdminRelativeTime } from '../hooks/useFormatAdminRelativeTime';
import { useReportReasonLabel } from '../hooks/useReportReasonLabel';
import type { AdminReport } from '../types';
import { AdminReportOthersBadge, AdminReportSlowBadge } from './AdminReportBadges';

interface AdminReportListItemProps {
  report: AdminReport;
  // "Bây giờ" (useNow) để tính "Chờ lâu" và nhãn thời gian tương đối.
  now: number;
  // Màn rộng (xl): bấm dòng là CHỌN để xem nhanh ở khung bên phải. Màn hẹp: dòng là link sang trang chi tiết (không có khung xem nhanh).
  isWide: boolean;
  isSelected: boolean;
  onSelect: (reportId: string) => void;
}

const ITEM_CLASS =
  'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50';

// Một dòng của hàng đợi (phương án B của wireframe): biểu tượng loại, tên đối tượng, "lý do · thời gian" và huy hiệu mức độ. Chỉ ba thứ Admin
// dùng để chọn báo cáo nào xử lý trước (loại + lý do, số người cùng báo, tuổi) nằm ở đây; nội dung đầy đủ ở khung xem nhanh / trang chi tiết.
export function AdminReportListItem({
  report,
  now,
  isWide,
  isSelected,
  onSelect,
}: AdminReportListItemProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const reasonLabel = useReportReasonLabel();
  const formatRelative = useFormatAdminRelativeTime();
  const { icon: Icon, labelKey } = ADMIN_REPORT_TYPE_DISPLAY[report.targetType];
  const title = adminReportTargetTitle(report);
  // Dòng đang chọn nền `bg-muted`: chữ phụ phải đậm hơn `text-muted-foreground` (đo 4,35:1 < 4,5:1) — rules/frontend.md mục 5.
  const secondaryClass = isWide && isSelected ? 'text-foreground/75' : 'text-muted-foreground';

  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span title={title} className="truncate text-sm font-medium text-foreground">
          <span className="sr-only">{tDynamic(labelKey)}: </span>
          {title}
        </span>
        <span className={cn('truncate text-xs', secondaryClass)}>
          {t('reportsReasonLine', {
            reason: reasonLabel(report.reasonCode),
            time: formatRelative(report.createdAt, now),
          })}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <AdminReportOthersBadge count={report.sameTargetOpenCount} />
        {isAdminReportSlow(report, now) ? <AdminReportSlowBadge /> : null}
      </span>
    </>
  );

  const selectedClass = isWide && isSelected ? 'bg-muted hover:bg-muted' : undefined;

  return (
    <li>
      {isWide ? (
        <button
          type="button"
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => onSelect(report.id)}
          className={cn(ITEM_CLASS, selectedClass)}
        >
          {content}
        </button>
      ) : (
        <Link href={buildAdminReportDetailHref(report.id)} className={ITEM_CLASS}>
          {content}
        </Link>
      )}
    </li>
  );
}
