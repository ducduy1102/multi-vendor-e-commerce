'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { Badge } from '@/shared/components/ui/badge';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { useNow } from '@/shared/hooks/useNow';
import { ApiError } from '@/shared/lib/api-client';

import {
  ADMIN_REPORT_REVERT_COPY,
  ADMIN_REPORT_TYPE_DISPLAY,
  adminReportTargetTitle,
  isAdminReportSlow,
} from '../admin-report-display';
import { ADMIN_REPORTS_PATH } from '../admin-reports-href';
import { useAdminReport } from '../hooks/useAdminReport';
import { useAdminReportResolveFlow } from '../hooks/useAdminReportResolveFlow';
import { useAdminReportRevertFlow } from '../hooks/useAdminReportRevertFlow';
import { ADMIN_REPORT_DETAIL_LAYOUT_CLASS } from './admin-report-layout.constants';
import { AdminReportActionPanel } from './AdminReportActionPanel';
import { AdminReportConfirmDialog } from './AdminReportConfirmDialog';
import { AdminReportSlowBadge } from './AdminReportBadges';
import { AdminReportDetailSkeleton } from './AdminReportDetailSkeleton';
import { AdminReportReasonCard, AdminReportTargetCard } from './AdminReportDetailCards';
import { AdminReportReopenDialog } from './AdminReportReopenDialog';
import { AdminReportResultCard } from './AdminReportResultCard';

interface AdminReportDetailContainerProps {
  // Đã được page.tsx kiểm là UUID (id sai dạng ⇒ notFound, không gọi API).
  reportId: string;
}

// Trang chi tiết một báo cáo (Week11.md 5.6, phương án A: hai cột, panel Xử lý dính khi cuộn). Container nối UI thuần với hook:
//  - chờ xử lý: nội dung bị báo + lý do ở bên trái, panel Xử lý (hành động + ghi chú) bên phải, xác nhận trong hộp thoại;
//  - đã xử lý: thay panel bằng "Kết quả xử lý"; báo cáo ĐÁNH GIÁ đã ẩn có thêm nút "Mở lại đánh giá" và báo cáo SẢN PHẨM đã gỡ có thêm nút
//    "Khôi phục sản phẩm" (sửa nhầm, lý do bắt buộc — cùng một luồng, xem useAdminReportRevertFlow);
//  - 404: câu giải thích + link về hàng đợi; lỗi khác: câu chung + nút thử lại.
export function AdminReportDetailContainer({ reportId }: AdminReportDetailContainerProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const tCommon = useTranslations('common');
  const now = useNow();
  const reportQuery = useAdminReport(reportId);
  const flow = useAdminReportResolveFlow(reportId);

  const report = reportQuery.data;
  const revert = useAdminReportRevertFlow(report);

  if (!report) {
    if (reportQuery.isPending) {
      return (
        <div aria-busy="true">
          <span className="sr-only">{tCommon('loading')}</span>
          <AdminReportDetailSkeleton />
        </div>
      );
    }
    const isNotFound = reportQuery.error instanceof ApiError && reportQuery.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {isNotFound ? t('reportNotFound') : t('reportLoadError')}
        </p>
        {isNotFound ? (
          <Link
            href={ADMIN_REPORTS_PATH}
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            {t('reportBackToList')}
          </Link>
        ) : (
          <Button type="button" variant="outline" onClick={() => void reportQuery.refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  const isOpen = report.status === 'OPEN';
  const revertCopy = revert.kind ? ADMIN_REPORT_REVERT_COPY[revert.kind] : null;
  const typeLabel = tDynamic(ADMIN_REPORT_TYPE_DISPLAY[report.targetType].labelKey);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <nav
          aria-label={t('reportDetailBreadcrumbLabel')}
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link
            href={ADMIN_REPORTS_PATH}
            className="-mx-1 inline-flex min-h-9 items-center rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('reportDetailBackToList')}
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5" />
          <span aria-current="page">{typeLabel}</span>
        </nav>
        <h1 className="min-w-0 text-xl font-semibold text-balance text-foreground [overflow-wrap:anywhere]">
          {t('reportDetailTitle', { type: typeLabel, name: adminReportTargetTitle(report) })}
        </h1>
        {isOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground">
              {t('reportStatusOpen')}
            </Badge>
            {isAdminReportSlow(report, now) ? <AdminReportSlowBadge /> : null}
          </div>
        ) : null}
      </div>

      {/* Câu lỗi của lần xử lý nằm NGOÀI panel: lỗi 409 (Admin khác xử lý trước) làm mới dữ liệu và panel Xử lý biến thành "Kết quả xử lý" —
          nếu câu lỗi nằm trong panel thì nó biến mất cùng panel và người dùng không biết vì sao hành động của mình không được áp dụng. */}
      {flow.actionError ? <Alert variant="destructive">{flow.actionError}</Alert> : null}

      <div className={ADMIN_REPORT_DETAIL_LAYOUT_CLASS}>
        <div className="flex min-w-0 flex-col gap-4">
          <AdminReportTargetCard
            report={report}
            isRestored={revert.kind === 'PRODUCT' && revert.isDone}
          />
          <AdminReportReasonCard report={report} now={now} />
        </div>

        {isOpen ? (
          <AdminReportActionPanel
            key={report.id}
            report={report}
            isPending={flow.isPending}
            onRequest={flow.request}
          />
        ) : (
          <AdminReportResultCard
            report={report}
            now={now}
            footer={
              revertCopy ? (
                revert.isDone ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {tDynamic(revertCopy.doneKey)}
                  </p>
                ) : (
                  <>
                    <Button type="button" variant="outline" size="lg" onClick={revert.open}>
                      {tDynamic(revertCopy.buttonKey)}
                    </Button>
                    <p className="text-xs text-pretty text-muted-foreground">
                      {tDynamic(revertCopy.hintKey)}
                    </p>
                  </>
                )
              ) : undefined
            }
          />
        )}
      </div>

      {flow.dialog.input ? (
        <AdminReportConfirmDialog
          open={flow.dialog.isOpen}
          onOpenChange={flow.dialog.onOpenChange}
          input={flow.dialog.input}
          othersCount={report.sameTargetOpenCount}
          isPending={flow.dialog.isPending}
          onConfirm={flow.dialog.onConfirm}
        />
      ) : null}

      {revertCopy ? (
        <AdminReportReopenDialog
          open={revert.isOpen}
          onOpenChange={revert.onOpenChange}
          isPending={revert.isPending}
          error={revert.error}
          onConfirm={revert.confirm}
          copy={revertCopy}
        />
      ) : null}
    </div>
  );
}
