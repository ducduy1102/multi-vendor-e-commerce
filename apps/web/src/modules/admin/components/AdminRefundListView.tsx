'use client';

import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';

import { Button } from '@/shared/components/ui/button';

import {
  buildAdminRefundsPagination,
  type AdminRefundTab,
  type AdminRefundsPageQuery,
} from '../admin-refunds-href';
import { ADMIN_REFUND_LIST_LABEL_KEYS } from '../admin-refund-display';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ADMIN_REFUND_TABLE_CLASS } from './admin-refund-row.constants';
import { AdminRefundListHeader } from './AdminRefundListHeader';
import { AdminRefundListSkeleton } from './AdminRefundListSkeleton';
import { AdminShopPagination } from './AdminShopPagination';

interface AdminRefundListViewProps<TItem extends { id: string }> {
  tab: AdminRefundTab;
  // Query đang xem — để dựng link phân trang giữ đúng tab + bộ lọc.
  pageQuery: AdminRefundsPageQuery;
  data: { items: TItem[]; total: number; limit: number } | undefined;
  isPending: boolean;
  onReload: () => void;
  // Câu hiện khi danh sách rỗng (đã dịch, theo bộ lọc đang xem).
  emptyMessage: string;
  renderRow: (item: TItem) => ReactNode;
}

// Khung trạng thái dùng chung của cả ba bảng: đang tải (skeleton khớp bảng thật, aria-busy + dòng sr-only), lỗi (kèm
// "Thử lại"), rỗng, danh sách + phân trang (rules/frontend.md mục 10). Có dữ liệu thì luôn hiện dữ liệu — lần tải lại
// ngầm lỗi (đổi tab về, mạng chớp) không được xoá mất danh sách đang xem; chỉ báo lỗi khi chưa có gì để hiện. Chỉ lo
// KHUNG: dòng cụ thể do nơi dùng truyền qua `renderRow`.
export function AdminRefundListView<TItem extends { id: string }>({
  tab,
  pageQuery,
  data,
  isPending,
  onReload,
  emptyMessage,
  renderRow,
}: AdminRefundListViewProps<TItem>) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tDynamic = t as unknown as LooseTranslator;

  if (!data) {
    return isPending ? (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <AdminRefundListSkeleton tab={tab} />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('refundsLoadError')}
        </p>
        <Button type="button" variant="outline" onClick={onReload}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const pagination = buildAdminRefundsPagination({
    query: pageQuery,
    total: data.total,
    limit: data.limit,
  });

  return (
    <>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className={ADMIN_REFUND_TABLE_CLASS}>
          <AdminRefundListHeader tab={tab} />
          <ul
            aria-label={tDynamic(ADMIN_REFUND_LIST_LABEL_KEYS[tab])}
            className="divide-y divide-border"
          >
            {data.items.map((item) => (
              <Fragment key={item.id}>{renderRow(item)}</Fragment>
            ))}
          </ul>
        </div>
      )}

      <AdminShopPagination
        page={pageQuery.page}
        totalPages={pagination.totalPages}
        prevHref={pagination.prevHref}
        nextHref={pagination.nextHref}
      />
    </>
  );
}
