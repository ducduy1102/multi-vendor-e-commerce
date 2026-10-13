import {
  adminRefundListFilterSchema,
  adminRefundListQuerySchema,
  type AdminRefundListFilter,
  type RefundRequestStatus,
} from '@ecommerce/types';
import { z } from 'zod';

export const ADMIN_REFUNDS_PATH = '/admin/refunds';

// Ba màn của khu hoàn tiền, mỗi màn là một tab dạng link (`?tab=`): khiếu nại/yêu cầu cần Admin quyết, sổ cái
// hoàn tiền (khoản lỗi/đang chờ), thanh toán bất thường chưa có khoản hoàn nào.
export const ADMIN_REFUND_TABS = ['disputes', 'failed', 'payments'] as const;
export type AdminRefundTab = (typeof ADMIN_REFUND_TABS)[number];
// Hàng chờ khiếu nại là việc Admin phải quyết (người mua đã khiếu nại, tiền đang bị giữ) nên đứng đầu và là mặc định.
export const DEFAULT_ADMIN_REFUND_TAB: AdminRefundTab = 'disputes';

export const ADMIN_REFUND_TAB_LABEL_KEYS: Record<AdminRefundTab, string> = {
  disputes: 'refundsTabDisputes',
  failed: 'refundsTabFailed',
  payments: 'refundsTabPayments',
};

// Bộ lọc con của tab "Khiếu nại": yêu cầu đã lên sàn (việc chính) hoặc còn chờ shop (Admin ghi đè khi shop vắng
// mặt — BE cho phép Admin quyết cả hai, xem canActorTransitionRefundRequest). Mặc định ESCALATED.
export const ADMIN_DISPUTE_FILTERS = [
  'ESCALATED',
  'PENDING_SELLER',
] as const satisfies readonly RefundRequestStatus[];
export type AdminDisputeFilter = (typeof ADMIN_DISPUTE_FILTERS)[number];
export const DEFAULT_ADMIN_DISPUTE_FILTER: AdminDisputeFilter = 'ESCALATED';
export const ADMIN_DISPUTE_FILTER_LABEL_KEYS: Record<AdminDisputeFilter, string> = {
  ESCALATED: 'refundsFilterEscalated',
  PENDING_SELLER: 'refundsFilterPendingSeller',
};

// Bộ lọc con của tab "Hoàn tiền lỗi" = đúng 4 giá trị BE nhận (adminRefundListFilterSchema); mặc định
// NEEDS_ACTION là tập Admin được thử lại/ghi nhận thủ công.
export const ADMIN_LEDGER_FILTERS: readonly AdminRefundListFilter[] =
  adminRefundListFilterSchema.options;
export const DEFAULT_ADMIN_LEDGER_FILTER: AdminRefundListFilter = 'NEEDS_ACTION';
export const ADMIN_LEDGER_FILTER_LABEL_KEYS: Record<AdminRefundListFilter, string> = {
  NEEDS_ACTION: 'refundsFilterNeedsAction',
  PENDING: 'refundsFilterPending',
  FAILED: 'refundsFilterFailed',
  SUCCEEDED: 'refundsFilterSucceeded',
};

export type AdminRefundsPageQuery =
  | { tab: 'disputes'; status: AdminDisputeFilter; page: number }
  | { tab: 'failed'; status: AdminRefundListFilter; page: number }
  | { tab: 'payments'; page: number };

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?tab=a&tab=b) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const tabSchema = z.enum(ADMIN_REFUND_TABS);
const disputeFilterSchema = z.enum(ADMIN_DISPUTE_FILTERS);

// Đọc `?tab=&status=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: từng
// param sai dạng rơi về mặc định ĐỘC LẬP (tab lạ không làm mất trang đang xem, và ngược lại), không bao giờ ném
// lỗi làm sập trang. `status` chỉ có nghĩa theo tab: hợp lệ của tab này (vd NEEDS_ACTION) có thể không hợp lệ
// của tab kia (ESCALATED) nên kiểm theo tab đã chọn. Dùng lại chính schema BE (trang coerce) để hai phía không
// lệch luật.
export function parseAdminRefundsPageQuery(raw: RawSearchParams): AdminRefundsPageQuery {
  const parsedTab = tabSchema.safeParse(firstValue(raw.tab));
  const tab = parsedTab.success ? parsedTab.data : DEFAULT_ADMIN_REFUND_TAB;
  const parsedPage = adminRefundListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  const page = parsedPage.success ? parsedPage.data : 1;
  const status = firstValue(raw.status);

  if (tab === 'disputes') {
    const parsed = disputeFilterSchema.safeParse(status);
    return { tab, status: parsed.success ? parsed.data : DEFAULT_ADMIN_DISPUTE_FILTER, page };
  }
  if (tab === 'failed') {
    const parsed = adminRefundListFilterSchema.safeParse(status);
    return { tab, status: parsed.success ? parsed.data : DEFAULT_ADMIN_LEDGER_FILTER, page };
  }
  return { tab, page };
}

interface HrefInput {
  tab?: AdminRefundTab;
  status?: string;
  page?: number;
}

// URL của trang — bỏ param nào là mặc định (tab khiếu nại, bộ lọc mặc định của tab, trang 1) để link gọn và
// trùng URL người dùng tự gõ. `status` bị bỏ qua ở tab không có bộ lọc con. Không kèm locale: Link của
// next-intl tự thêm.
export function buildAdminRefundsHref({ tab, status, page }: HrefInput = {}): string {
  const currentTab = tab ?? DEFAULT_ADMIN_REFUND_TAB;
  const searchParams = new URLSearchParams();
  if (currentTab !== DEFAULT_ADMIN_REFUND_TAB) searchParams.set('tab', currentTab);
  const defaultStatus =
    currentTab === 'disputes'
      ? DEFAULT_ADMIN_DISPUTE_FILTER
      : currentTab === 'failed'
        ? DEFAULT_ADMIN_LEDGER_FILTER
        : undefined;
  if (status && defaultStatus && status !== defaultStatus) searchParams.set('status', status);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${ADMIN_REFUNDS_PATH}?${query}` : ADMIN_REFUNDS_PATH;
}

// Query (đã parse) -> tham số của buildAdminRefundsHref, giữ tab + bộ lọc đang xem.
export function toAdminRefundsHrefInput(query: AdminRefundsPageQuery): HrefInput {
  return 'status' in query
    ? { tab: query.tab, status: query.status, page: query.page }
    : { tab: query.tab, page: query.page };
}

interface PaginationInput {
  query: AdminRefundsPageQuery;
  total: number;
  limit: number;
}

// `totalPages` tối thiểu 1. Trang hiện tại có thể VƯỢT totalPages (gõ tay ?page=99, hoặc xử lý xong dòng cuối của
// trang cuối làm trang đó biến mất) — "Trang trước" khi đó nhảy thẳng về trang cuối thật thay vì page - 1 (vẫn
// rỗng), còn "Trang sau" giữ nguyên trang hiện tại.
export function buildAdminRefundsPagination({ query, total, limit }: PaginationInput): {
  totalPages: number;
  prevHref: string;
  nextHref: string;
} {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const base = toAdminRefundsHrefInput(query);
  return {
    totalPages,
    prevHref: buildAdminRefundsHref({
      ...base,
      page: Math.max(1, Math.min(query.page - 1, totalPages)),
    }),
    nextHref: buildAdminRefundsHref({ ...base, page: Math.min(query.page + 1, totalPages) }),
  };
}
