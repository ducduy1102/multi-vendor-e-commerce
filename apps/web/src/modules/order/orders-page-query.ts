import { orderListQuerySchema, orderTabSchema, sellerOrderTabSchema } from '@ecommerce/types';

import type { OrderTab, SellerOrderTab } from './types';

export interface OrdersPageQuery {
  tab: OrderTab | undefined;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?tab=a&tab=b) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?tab=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin:
// từng param sai dạng rơi về mặc định ĐỘC LẬP (tab lạ không làm mất trang đang xem, và ngược lại),
// không bao giờ ném lỗi làm sập trang. Dùng lại chính schema BE (tab enum, page coerce) để 2 phía
// không lệch luật.
export function parseOrdersPageQuery(raw: RawSearchParams): OrdersPageQuery {
  const tab = orderTabSchema.safeParse(firstValue(raw.tab));
  const page = orderListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  return {
    tab: tab.success ? tab.data : undefined,
    page: page.success ? page.data : 1,
  };
}

export interface SellerOrdersPageQuery {
  tab: SellerOrderTab | undefined;
  page: number;
}

// Như parseOrdersPageQuery nhưng tab theo schema của SELLER: `?tab=awaiting-payment` KHÔNG hợp lệ
// (đơn chưa thanh toán không được lộ cho Seller, BE trả 400 nếu nhận tab đó) nên rơi về "Tất cả"
// thay vì gửi yêu cầu chắc chắn lỗi lên API.
export function parseSellerOrdersPageQuery(raw: RawSearchParams): SellerOrdersPageQuery {
  const tab = sellerOrderTabSchema.safeParse(firstValue(raw.tab));
  const page = orderListQuerySchema.shape.page.safeParse(firstValue(raw.page));
  return {
    tab: tab.success ? tab.data : undefined,
    page: page.success ? page.data : 1,
  };
}
