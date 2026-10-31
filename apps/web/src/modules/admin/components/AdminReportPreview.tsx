'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { buttonVariants } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

import {
  ADMIN_REPORT_TYPE_DISPLAY,
  describeAdminReportResult,
  isAdminReportSlow,
} from '../admin-report-display';
import { buildAdminReportDetailHref } from '../admin-reports-href';
import { useFormatAdminRelativeTime } from '../hooks/useFormatAdminRelativeTime';
import { useReportReasonLabel } from '../hooks/useReportReasonLabel';
import type { AdminReport } from '../types';
import { AdminReportOthersBadge, AdminReportSlowBadge } from './AdminReportBadges';
import { AdminReportSnapshot } from './AdminReportSnapshot';
import { AdminToneBadge } from './AdminToneBadge';

interface AdminReportPreviewProps {
  report: AdminReport;
  now: number;
}

// Khung xem nhanh bên phải của hàng đợi (chỉ có từ `xl`, phương án B): đọc ĐỦ nội dung bị báo, lý do và người báo ngay cạnh danh sách mà
// không phải mở từng trang. Chỉ ĐỌC — mọi hành động xử lý nằm ở trang chi tiết (nút "Mở để xử lý"), nên không có chỗ nào ở đây để bấm nhầm
// một hành động huỷ bỏ. Dính đầu khung khi cuộn danh sách dài.
export function AdminReportPreview({ report, now }: AdminReportPreviewProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const reasonLabel = useReportReasonLabel();
  const formatRelative = useFormatAdminRelativeTime();
  const { labelKey } = ADMIN_REPORT_TYPE_DISPLAY[report.targetType];
  const isOpen = report.status === 'OPEN';

  return (
    <aside
      aria-label={t('reportsPreviewLabel')}
      className="sticky top-4 flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{tDynamic(labelKey)}</Badge>
        <span className="text-xs text-muted-foreground">
          {formatRelative(report.createdAt, now)}
        </span>
        {isAdminReportSlow(report, now) ? <AdminReportSlowBadge /> : null}
        {!isOpen && report.resolution ? (
          <AdminToneBadge display={describeAdminReportResult(report.resolution.action)} />
        ) : null}
      </div>

      <AdminReportSnapshot report={report} />

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{reasonLabel(report.reasonCode)}</p>
        {report.note ? (
          <p className="text-sm text-pretty whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
            {report.note}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('reportsNoNote')}</p>
        )}
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t('reportsReporterLine', { name: report.reporter.name, email: report.reporter.email })}
        </p>
        {report.sameTargetOpenCount > 0 ? (
          <div className="pt-1">
            <AdminReportOthersBadge count={report.sameTargetOpenCount} />
          </div>
        ) : null}
      </div>

      <Link
        href={buildAdminReportDetailHref(report.id)}
        className={buttonVariants({ variant: isOpen ? 'default' : 'outline', size: 'lg' })}
      >
        {isOpen ? t('reportsOpenToHandle') : t('reportsViewAgain')}
        {isOpen ? <ArrowRight aria-hidden="true" data-icon="inline-end" /> : null}
      </Link>
    </aside>
  );
}
