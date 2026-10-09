import { sellerRefundRequestListQuerySchema } from '@ecommerce/types';

import type { SellerRefundRequestListQuery } from './types';

export const SELLER_REFUND_REQUESTS_PATH = '/seller/refund-requests';

// Trạng thái BE lọc được (không có WITHDRAWN: yêu cầu đã rút không bao giờ hiện cho shop).
export type SellerRefundRequestStatus = NonNullable<SellerRefundRequestListQuery['status']>;

// Bộ lọc của trang. 'all' là lựa chọn ảo (không gửi `status` lên BE = mọi yêu cầu chưa rút).
export type SellerRefundRequestFilter = SellerRefundRequestStatus | 'all';

// Tab mặc định (URL không có `?status=`) là hàng chờ phải trả lời: người bán vào trang này để xử lý việc đang
// chờ mình, không phải để đọc lịch sử — xem cả hàng chờ lẫn đã xử lý là một cú bấm sang "Tất cả".
export const DEFAULT_SELLER_REFUND_REQUEST_FILTER: SellerRefundRequestFilter = 'PENDING_SELLER';

// Thứ tự tab: việc cần làm trước, rồi tới các kết quả. Khớp enum BE (sellerRefundRequestListQuerySchema).
export const SELLER_REFUND_REQUEST_FILTERS: readonly SellerRefundRequestFilter[] = [
  'PENDING_SELLER',
  'ESCALATED',
  'APPROVED',
  'REJECTED_BY_SELLER',
  'REJECTED',
  'all',
];

export const SELLER_REFUND_REQUEST_FILTER_LABEL_KEYS: Record<SellerRefundRequestFilter, string> = {
  PENDING_SELLER: 'refundQueueTabPending',
  ESCALATED: 'refundQueueTabEscalated',
  APPROVED: 'refundQueueTabApproved',
  REJECTED_BY_SELLER: 'refundQueueTabRejectedBySeller',
  REJECTED: 'refundQueueTabRejected',
  all: 'refundQueueTabAll',
};

export interface SellerRefundRequestsPageQuery {
  filter: SellerRefundRequestFilter;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?status=a&status=b) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?status=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ nên KHÔNG tin: từng param sai dạng
// rơi về mặc định ĐỘC LẬP. `?status=WITHDRAWN` không hợp lệ (BE trả 400) nên cũng rơi về tab mặc định thay vì gửi
// yêu cầu chắc chắn lỗi lên API. Dùng lại chính schema BE để hai phía không lệch luật.
export function parseSellerRefundRequestsPageQuery(
  raw: RawSearchParams,
): SellerRefundRequestsPageQuery {
  const status = firstValue(raw.status);
  const parsedStatus = sellerRefundRequestListQuerySchema.shape.status.safeParse(status);
  const page = sellerRefundRequestListQuerySchema.shape.page.safeParse(firstValue(raw.page));

  let filter: SellerRefundRequestFilter = DEFAULT_SELLER_REFUND_REQUEST_FILTER;
  if (status === 'all') filter = 'all';
  else if (parsedStatus.success && parsedStatus.data) filter = parsedStatus.data;

  return { filter, page: page.success ? page.data : 1 };
}

// Bộ lọc → tham số `status` gửi BE: 'all' thì không gửi.
export function toRefundRequestStatusParam(
  filter: SellerRefundRequestFilter,
): SellerRefundRequestStatus | undefined {
  return filter === 'all' ? undefined : filter;
}

interface HrefInput {
  filter?: SellerRefundRequestFilter;
  page?: number;
}

// URL của trang hàng chờ — bỏ param nào là mặc định (tab mặc định, trang 1) để link gọn và trùng URL người dùng
// tự gõ. Không kèm locale: Link của next-intl tự thêm.
export function buildSellerRefundRequestsHref({ filter, page }: HrefInput = {}): string {
  const searchParams = new URLSearchParams();
  if (filter && filter !== DEFAULT_SELLER_REFUND_REQUEST_FILTER) {
    searchParams.set('status', filter);
  }
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${SELLER_REFUND_REQUESTS_PATH}?${query}` : SELLER_REFUND_REQUESTS_PATH;
}

interface PaginationInput {
  filter: SellerRefundRequestFilter;
  page: number;
  total: number;
  limit: number;
}

// Giống buildOrdersPagination: `totalPages` tối thiểu 1; trang hiện tại có thể VƯỢT totalPages (gõ tay ?page=99,
// hoặc xử lý xong yêu cầu cuối của trang cuối) — "Trang trước" khi đó nhảy thẳng về trang cuối thật.
export function buildSellerRefundRequestsPagination({
  filter,
  page,
  total,
  limit,
}: PaginationInput): { totalPages: number; prevHref: string; nextHref: string } {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildSellerRefundRequestsHref({
      filter,
      page: Math.max(1, Math.min(page - 1, totalPages)),
    }),
    nextHref: buildSellerRefundRequestsHref({ filter, page: Math.min(page + 1, totalPages) }),
  };
}
