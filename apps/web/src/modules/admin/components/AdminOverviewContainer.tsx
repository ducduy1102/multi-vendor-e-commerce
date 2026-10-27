'use client';

import { useTranslations } from 'next-intl';

import { ADMIN_OVERVIEW_QUEUES, hasAnyAdminWork } from '../admin-overview-display';
import { useAdminOverview } from '../hooks/useAdminOverview';
import { AdminOverviewSkeleton } from './AdminOverviewSkeleton';
import { AdminOverviewEmpty, AdminOverviewError } from './AdminOverviewStates';
import { AdminQueueCard } from './AdminQueueCard';
import { AdminShortcuts } from './AdminShortcuts';

// Nối dữ liệu (useAdminOverview) với UI thuần của trang /admin. Đủ loading/error/empty/có dữ liệu (rules/frontend.md
// mục 10). Trả về Fragment: các khối là con trực tiếp của <main> của layout (khoảng cách `gap-6` do layout lo). Container
// không cần unit test (mục 8) — phần có logic đã tách ra hàm thuần có test (admin-overview-display) và component thuần.
export function AdminOverviewContainer() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const query = useAdminOverview();
  // Có dữ liệu thì luôn hiện dữ liệu — lần tải lại ngầm lỗi (mạng chớp) không được xoá mất số đang xem; chỉ báo lỗi khi
  // chưa có gì để hiện.
  const overview = query.data;

  if (!overview) {
    if (query.isPending) {
      return (
        <>
          <section aria-label={t('overviewQueuesLabel')} aria-busy="true">
            <span className="sr-only">{tCommon('loading')}</span>
            <AdminOverviewSkeleton />
          </section>
          <AdminShortcuts />
        </>
      );
    }
    return (
      <>
        <AdminOverviewError onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
        <AdminShortcuts />
      </>
    );
  }

  if (!hasAnyAdminWork(overview)) {
    return <AdminOverviewEmpty />;
  }

  return (
    <>
      <section aria-label={t('overviewQueuesLabel')}>
        <div className="grid grid-cols-2 gap-3">
          {ADMIN_OVERVIEW_QUEUES.map((queue) => (
            <AdminQueueCard key={queue.key} definition={queue} count={overview[queue.key]} />
          ))}
        </div>
      </section>
      <AdminShortcuts />
    </>
  );
}
