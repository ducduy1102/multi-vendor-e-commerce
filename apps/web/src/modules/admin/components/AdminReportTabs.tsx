'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { getTabLinkClass } from '@/shared/lib/tab-link-class';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_REPORT_TAB_DISPLAY,
  ADMIN_REPORT_TAB_FILTERS,
  ADMIN_REPORT_TYPE_DISPLAY,
} from '../admin-report-display';
import { buildAdminReportsHref } from '../admin-reports-href';
import type { AdminReportListFilter, ReportTargetType } from '../types';
import { ADMIN_TAB_SCROLL_CLASS } from './admin-tab-fade.constants';

interface AdminReportTabsProps {
  activeStatus: AdminReportListFilter;
  activeType: ReportTargetType | undefined;
}

const CHIP_CLASS =
  'inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const CHIP_ACTIVE_CLASS = 'border-primary bg-primary/5 font-medium text-primary';
const CHIP_IDLE_CLASS =
  'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground';

const TYPES = Object.keys(ADMIN_REPORT_TYPE_DISPLAY) as ReportTargetType[];

// Hai hàng điều khiển của hàng đợi: tab Chờ xử lý / Đã xử lý và chip lọc theo loại đối tượng. Cả hai là LINK thường (đổi `?status=&type=`
// trên URL, page.tsx đọc lại qua searchParams) nên chia sẻ / refresh / nút Back đều giữ đúng bộ lọc; đổi tab hay loại luôn về trang 1.
// Cả hai hàng tự cuộn ngang trong khung của chúng (mép mờ) trên màn hẹp.
export function AdminReportTabs({ activeStatus, activeType }: AdminReportTabsProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={t('reportsTabsLabel')} className={ADMIN_TAB_SCROLL_CLASS}>
        <ul className="flex min-w-max gap-1 border-b border-border">
          {ADMIN_REPORT_TAB_FILTERS.map((status) => {
            const isActive = status === activeStatus;
            return (
              <li key={status}>
                <Link
                  href={buildAdminReportsHref({ status, targetType: activeType })}
                  aria-current={isActive ? 'page' : undefined}
                  className={getTabLinkClass(isActive)}
                >
                  {tDynamic(ADMIN_REPORT_TAB_DISPLAY[status].tabLabelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label={t('reportsTypeFilterLabel')} className={ADMIN_TAB_SCROLL_CLASS}>
        <ul className="flex min-w-max items-center gap-2">
          <li>
            <Link
              href={buildAdminReportsHref({ status: activeStatus })}
              aria-current={activeType === undefined ? 'true' : undefined}
              className={cn(
                CHIP_CLASS,
                activeType === undefined ? CHIP_ACTIVE_CLASS : CHIP_IDLE_CLASS,
              )}
            >
              {t('reportsTypeAll')}
            </Link>
          </li>
          {TYPES.map((type) => {
            const isActive = type === activeType;
            return (
              <li key={type}>
                <Link
                  href={buildAdminReportsHref({ status: activeStatus, targetType: type })}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(CHIP_CLASS, isActive ? CHIP_ACTIVE_CLASS : CHIP_IDLE_CLASS)}
                >
                  {tDynamic(ADMIN_REPORT_TYPE_DISPLAY[type].labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
