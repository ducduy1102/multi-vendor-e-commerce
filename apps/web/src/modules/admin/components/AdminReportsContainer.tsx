'use client';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useNow } from '@/shared/hooks/useNow';

import { ADMIN_REPORT_TAB_DISPLAY } from '../admin-report-display';
import { buildAdminReportsPagination } from '../admin-reports-href';
import { useAdminReports } from '../hooks/useAdminReports';
import type { AdminReportListFilter, ReportTargetType } from '../types';
import {
  ADMIN_REPORT_LAYOUT_CLASS,
  ADMIN_REPORT_LIST_CLASS,
  ADMIN_REPORT_WIDE_QUERY,
} from './admin-report-layout.constants';
import { AdminReportListItem } from './AdminReportListItem';
import { AdminReportListSkeleton } from './AdminReportListSkeleton';
import { AdminReportPreview } from './AdminReportPreview';
import { AdminReportTabs } from './AdminReportTabs';
import { AdminShopPagination } from './AdminShopPagination';

interface AdminReportsContainerProps {
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseAdminReportsPageQuery).
  status: AdminReportListFilter;
  targetType: ReportTargetType | undefined;
  page: number;
}

// Hàng đợi báo cáo vi phạm (Week11.md 5.6, phương án B: danh sách + khung xem nhanh). Container nối UI thuần với hook, không viết logic
// nghiệp vụ riêng (không cần unit test theo rules/frontend.md mục 8, nhưng có test hành vi vì có nhánh theo khổ màn hình).
export function AdminReportsContainer({ status, targetType, page }: AdminReportsContainerProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const tCommon = useTranslations('common');
  const now = useNow();
  const isWide = useMediaQuery(ADMIN_REPORT_WIDE_QUERY);
  const reportsQuery = useAdminReports({ status, targetType, page });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const controls = <AdminReportTabs activeStatus={status} activeType={targetType} />;
  const data = reportsQuery.data;

  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách đang xem; chỉ báo lỗi khi
  // chưa có gì để hiện.
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {controls}
        {reportsQuery.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <AdminReportListSkeleton />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t('loadError')}
            </p>
            <Button type="button" variant="outline" onClick={() => void reportsQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { items, total, limit } = data;
  const pagination = buildAdminReportsPagination({ status, targetType, page, total, limit });
  // Dòng đang chọn; chưa chọn (hoặc dòng đã biến mất sau khi đổi tab / xử lý xong) thì rơi về dòng đầu.
  const selected = items.find((report) => report.id === selectedId) ?? items[0];
  const emptyDisplay = ADMIN_REPORT_TAB_DISPLAY[status];

  return (
    <div className="flex flex-col gap-4">
      {controls}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-14 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <p className="text-sm font-medium">{tDynamic(emptyDisplay.emptyKey)}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {tDynamic(emptyDisplay.emptyHintKey)}
          </p>
        </div>
      ) : (
        <div className={ADMIN_REPORT_LAYOUT_CLASS}>
          <div className={ADMIN_REPORT_LIST_CLASS}>
            <ul aria-label={t('reportsListLabel')} className="divide-y divide-border">
              {items.map((report) => (
                <AdminReportListItem
                  key={report.id}
                  report={report}
                  now={now}
                  isWide={isWide}
                  isSelected={report.id === selected?.id}
                  onSelect={setSelectedId}
                />
              ))}
            </ul>
          </div>
          {isWide && selected ? <AdminReportPreview report={selected} now={now} /> : null}
        </div>
      )}

      <AdminShopPagination
        page={page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />
    </div>
  );
}
