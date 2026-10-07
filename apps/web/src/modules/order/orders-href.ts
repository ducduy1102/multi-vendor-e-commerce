import type { OrderTab } from './types';

export const BUYER_ORDERS_PATH = '/orders';
export const SELLER_ORDERS_PATH = '/seller/orders';

interface OrdersLocation {
  tab?: OrderTab;
  page?: number;
  // Trang danh sách đang đứng: buyer /orders (mặc định) hoặc seller /seller/orders.
  basePath?: string;
}

// URL của trang danh sách đơn — bỏ param nào là mặc định (không tab = "Tất cả", page 1) để link gọn
// và trùng với URL người dùng tự gõ. Không kèm locale: Link của next-intl tự thêm.
export function buildOrdersHref({
  tab,
  page,
  basePath = BUYER_ORDERS_PATH,
}: OrdersLocation = {}): string {
  const searchParams = new URLSearchParams();
  if (tab) searchParams.set('tab', tab);
  if (page !== undefined && page > 1) searchParams.set('page', String(page));
  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

interface PaginationInput extends OrdersLocation {
  page: number;
  total: number;
  limit: number;
}

export interface OrdersPagination {
  totalPages: number;
  prevHref: string;
  nextHref: string;
}

// `totalPages` tối thiểu 1 (danh sách rỗng vẫn là "trang 1/1"). Trang hiện tại có thể VƯỢT
// totalPages (gõ tay ?page=99, hoặc hủy đơn cuối cùng của trang cuối làm trang đó biến mất) — khi
// đó nút "Trang trước" nhảy thẳng về trang cuối thật thay vì page - 1 (vẫn rỗng), còn "Trang sau"
// giữ nguyên trang hiện tại (không có trang nào sau nó).
export function buildOrdersPagination({
  tab,
  page,
  total,
  limit,
  basePath,
}: PaginationInput): OrdersPagination {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildOrdersHref({
      tab,
      page: Math.max(1, Math.min(page - 1, totalPages)),
      basePath,
    }),
    nextHref: buildOrdersHref({ tab, page: Math.min(page + 1, totalPages), basePath }),
  };
}
