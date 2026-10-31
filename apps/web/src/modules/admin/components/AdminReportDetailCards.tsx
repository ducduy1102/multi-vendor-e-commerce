'use client';

import { ArrowRight, ExternalLink, Layers, PackageX, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { buttonVariants } from '@/shared/components/ui/button';

import { reportedTargetGone, type AdminReportGoneTarget } from '../admin-report-display';
import { buildAdminShopsHref } from '../admin-shops-href';
import { useFormatAdminRelativeTime } from '../hooks/useFormatAdminRelativeTime';
import { useReportReasonLabel } from '../hooks/useReportReasonLabel';
import type { AdminReport } from '../types';
import { AdminReportSnapshot } from './AdminReportSnapshot';

const CARD_CLASS = 'flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4';

// Trang công khai của đối tượng để Admin đối chiếu với ảnh chụp: sản phẩm mở bằng ID (route chi tiết nhận cả id lẫn slug — ảnh chụp không lưu
// slug sản phẩm vì tên sản phẩm không có giới hạn độ dài), shop mở bằng slug. Hội thoại không có trang công khai.
function reportedTargetHref(report: AdminReport): { href: string; labelKey: string } | null {
  switch (report.targetType) {
    case 'REVIEW':
      return {
        href: `/products/${encodeURIComponent(report.snapshot.productId)}`,
        labelKey: 'reportOpenProduct',
      };
    case 'PRODUCT':
      return {
        href: `/products/${encodeURIComponent(report.targetId)}`,
        labelKey: 'reportOpenProduct',
      };
    case 'SHOP':
      return {
        href: `/shops/${encodeURIComponent(report.snapshot.slug)}`,
        labelKey: 'reportOpenShop',
      };
    case 'CONVERSATION':
      return null;
  }
}

// Đối tượng đã mất trang công khai (sản phẩm bị gỡ, shop bị khoá — xem `reportedTargetGone`): thay vì link trần dẫn Admin tới trang 404, hiện nhãn
// vô hiệu nói rõ lý do, giữ cùng một cách trình bày cho cả hai loại. Shop có thêm một đường tới nơi Admin xử lý được (tab "Bị khoá" của quản lý
// shop — "view tóm tắt trạng thái" thay cho trang công khai); sản phẩm chưa có trang quản trị riêng nên chỉ có nhãn.
function GoneTargetNote({
  gone,
  isRestored,
}: {
  gone: AdminReportGoneTarget;
  isRestored: boolean;
}) {
  const t = useTranslations('admin');

  if (gone === 'SHOP_SUSPENDED') {
    return (
      <div className="flex flex-col items-start gap-1">
        <p className="flex items-start gap-2 py-1 text-sm text-pretty text-muted-foreground">
          <Store aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t('reportShopSuspendedNote')}</span>
        </p>
        <Link
          href={buildAdminShopsHref({ status: 'SUSPENDED' })}
          className={buttonVariants({ variant: 'ghost', size: 'lg', className: '-ml-2.5' })}
        >
          {t('reportOpenShopAdmin')}
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </div>
    );
  }

  return (
    <p className="flex items-start gap-2 py-1 text-sm text-pretty text-muted-foreground">
      <PackageX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{t(isRestored ? 'reportProductRestoredNote' : 'reportProductTakenDownNote')}</span>
    </p>
  );
}

// Thẻ "Nội dung bị báo": ảnh chụp lúc báo (đọc ĐỦ, không rút gọn) + link sang trang công khai (hoặc nhãn vô hiệu khi trang đó không còn).
// `isRestored`: Admin vừa khôi phục sản phẩm ngay trong lần hiển thị này — sản phẩm về NHÁP nên vẫn chưa công khai, chỉ đổi câu nhãn.
export function AdminReportTargetCard({
  report,
  isRestored = false,
}: {
  report: AdminReport;
  isRestored?: boolean;
}) {
  const t = useTranslations('admin');
  const link = reportedTargetHref(report);
  const gone = reportedTargetGone(report);

  return (
    <section aria-labelledby={`report-target-${report.id}`} className={CARD_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={`report-target-${report.id}`} className="text-sm font-semibold">
          {t('reportTargetTitle')}
        </h2>
        <span className="text-xs text-pretty text-muted-foreground">{t('reportSnapshotNote')}</span>
      </div>
      <AdminReportSnapshot report={report} />
      {gone ? (
        <GoneTargetNote gone={gone} isRestored={isRestored} />
      ) : link ? (
        <div>
          <Link
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'lg', className: '-ml-2.5' })}
          >
            <ExternalLink aria-hidden="true" data-icon="inline-start" />
            {t(link.labelKey as 'reportOpenProduct' | 'reportOpenShop')}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

// Thẻ "Lý do báo cáo": lý do, mô tả, người báo (Admin được thấy tên + email để nhận ra tài khoản báo bừa), thời điểm và số người khác cùng báo.
export function AdminReportReasonCard({ report, now }: { report: AdminReport; now: number }) {
  const t = useTranslations('admin');
  const reasonLabel = useReportReasonLabel();
  const formatRelative = useFormatAdminRelativeTime();
  const others = report.sameTargetOpenCount;

  return (
    <section aria-labelledby={`report-reason-${report.id}`} className={CARD_CLASS}>
      <h2 id={`report-reason-${report.id}`} className="text-sm font-semibold">
        {t('reportReasonCardTitle')}
      </h2>
      <dl className="flex flex-col gap-2.5">
        <Term label={t('reportTermReason')}>
          <Badge variant="outline">{reasonLabel(report.reasonCode)}</Badge>
        </Term>
        <Term label={t('reportTermNote')}>
          {report.note ? (
            <span className="whitespace-pre-line [overflow-wrap:anywhere]">{report.note}</span>
          ) : (
            <span className="text-muted-foreground">{t('reportNoNoteGiven')}</span>
          )}
        </Term>
        <Term label={t('reportTermReporter')}>
          <span className="[overflow-wrap:anywhere]">
            {report.reporter.name}
            <span className="text-muted-foreground"> · {report.reporter.email}</span>
          </span>
        </Term>
        <Term label={t('reportTermSentAt')}>{formatRelative(report.createdAt, now)}</Term>
      </dl>
      {report.status === 'OPEN' && others > 0 ? (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
          <Layers aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-pretty">
            {t('reportSameTarget', { count: others, total: others + 1 })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
