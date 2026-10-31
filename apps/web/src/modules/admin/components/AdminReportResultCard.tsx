'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { describeAdminReportResult } from '../admin-report-display';
import { useFormatAdminRelativeTime } from '../hooks/useFormatAdminRelativeTime';
import type { AdminReport } from '../types';
import { AdminToneBadge } from './AdminToneBadge';

interface AdminReportResultCardProps {
  report: AdminReport;
  now: number;
  // Hành động sau kết quả (nút "Mở lại đánh giá") do Container truyền vào — thẻ không biết mutation nào.
  footer?: ReactNode;
}

// "Kết quả xử lý" của báo cáo đã đóng: ai xử lý, khi nào, hành động gì, ghi chú. Ghi chú do Admin nhập là văn bản tự do nên
// `[overflow-wrap:anywhere]`. Admin đã bị xoá tài khoản ⇒ BE trả `resolvedByName: null`, hiện "Quản trị viên đã xoá" thay vì để trống.
export function AdminReportResultCard({ report, now, footer }: AdminReportResultCardProps) {
  const t = useTranslations('admin');
  const formatRelative = useFormatAdminRelativeTime();
  const { resolution } = report;
  if (!resolution) return null;

  const time = formatRelative(resolution.resolvedAt, now);

  return (
    <section
      aria-label={t('reportResultTitle')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('reportResultTitle')}</h2>
        <AdminToneBadge display={describeAdminReportResult(resolution.action)} />
      </div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {resolution.resolvedByName
          ? t('reportResultBy', { name: resolution.resolvedByName, time })
          : t('reportResultByUnknown', { time })}
      </p>
      {resolution.note ? (
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{resolution.note}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('reportResultNoNote')}</p>
      )}
      {footer ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
