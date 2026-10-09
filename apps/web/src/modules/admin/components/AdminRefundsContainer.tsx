'use client';

import {
  ADMIN_DISPUTE_FILTERS,
  ADMIN_DISPUTE_FILTER_LABEL_KEYS,
  ADMIN_LEDGER_FILTERS,
  ADMIN_LEDGER_FILTER_LABEL_KEYS,
  type AdminRefundsPageQuery,
} from '../admin-refunds-href';
import { AdminDisputesPanel } from './AdminDisputesPanel';
import { AdminLedgerPanel } from './AdminLedgerPanel';
import { AdminPaymentsPanel } from './AdminPaymentsPanel';
import { AdminRefundFilterLinks } from './AdminRefundFilterLinks';
import { AdminRefundTabs } from './AdminRefundTabs';

interface AdminRefundsContainerProps {
  // Đã được page.tsx đọc + chuẩn hoá từ searchParams (parseAdminRefundsPageQuery).
  query: AdminRefundsPageQuery;
}

// Khung của khu hoàn tiền: tab + bộ lọc con luôn hiện, bên dưới là MỘT trong ba panel theo tab (mỗi panel tự gọi
// đúng hook dữ liệu và luồng hành động của nó — hook không được gọi có điều kiện nên tách thành component, không
// `if` trong một component chung). Container không cần unit test (rules/frontend.md mục 8) — phần có logic đã
// tách ra hàm thuần/hook/component có test (parseAdminRefundsPageQuery, buildAdminRefundsPagination,
// useAdminRefundActionFlow, các dòng, hộp thoại, khung danh sách).
export function AdminRefundsContainer({ query }: AdminRefundsContainerProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <AdminRefundTabs activeTab={query.tab} />
        {query.tab === 'disputes' ? (
          <AdminRefundFilterLinks
            tab="disputes"
            options={ADMIN_DISPUTE_FILTERS}
            labelKeys={ADMIN_DISPUTE_FILTER_LABEL_KEYS}
            activeStatus={query.status}
            ariaLabelKey="refundsDisputeFilterLabel"
          />
        ) : null}
        {query.tab === 'failed' ? (
          <AdminRefundFilterLinks
            tab="failed"
            options={ADMIN_LEDGER_FILTERS}
            labelKeys={ADMIN_LEDGER_FILTER_LABEL_KEYS}
            activeStatus={query.status}
            ariaLabelKey="refundsLedgerFilterLabel"
          />
        ) : null}
      </div>

      {query.tab === 'disputes' ? (
        <AdminDisputesPanel status={query.status} page={query.page} />
      ) : null}
      {query.tab === 'failed' ? <AdminLedgerPanel status={query.status} page={query.page} /> : null}
      {query.tab === 'payments' ? <AdminPaymentsPanel page={query.page} /> : null}
    </div>
  );
}
