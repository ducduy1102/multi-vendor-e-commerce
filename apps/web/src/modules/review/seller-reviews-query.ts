import { sellerReviewListQuerySchema } from '@ecommerce/types';

import type { SellerReviewListQuery } from './types';

export const SELLER_REVIEWS_PATH = '/seller/reviews';

// 'true' | 'false' đúng như trên URL/BE (xem sellerReviewListQuerySchema); undefined = cả hai.
export type SellerReviewRepliedFilter = SellerReviewListQuery['replied'];

export interface SellerReviewsPageQuery {
  replied: SellerReviewRepliedFilter;
  // Lọc theo số sao (1-5); undefined = tất cả.
  rating: number | undefined;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?rating=4&rating=5) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?replied=&rating=&page=` từ searchParams của page.tsx. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: từng
// param sai dạng (replied không phải true/false, số sao ngoài 1-5, trang không phải số dương) rơi về mặc định
// ĐỘC LẬP, không bao giờ ném lỗi làm sập trang. Dùng lại chính schema BE để hai phía không lệch luật.
export function parseSellerReviewsPageQuery(raw: RawSearchParams): SellerReviewsPageQuery {
  const { shape } = sellerReviewListQuerySchema;
  const replied = shape.replied.safeParse(firstValue(raw.replied));
  const rating = shape.rating.safeParse(firstValue(raw.rating));
  const page = shape.page.safeParse(firstValue(raw.page));
  return {
    replied: replied.success ? replied.data : undefined,
    rating: rating.success ? rating.data : undefined,
    page: page.success ? page.data : 1,
  };
}

// URL của trang kèm bộ lọc/trang — giá trị mặc định (tất cả, trang 1) không đưa lên URL để link gọn và trùng URL
// người dùng tự gõ. Không kèm locale: Link của next-intl tự thêm.
export function buildSellerReviewsHref(query: Partial<SellerReviewsPageQuery> = {}): string {
  const searchParams = new URLSearchParams();
  if (query.replied !== undefined) searchParams.set('replied', query.replied);
  if (query.rating !== undefined) searchParams.set('rating', String(query.rating));
  if (query.page !== undefined && query.page > 1) searchParams.set('page', String(query.page));
  const search = searchParams.toString();
  return search ? `${SELLER_REVIEWS_PATH}?${search}` : SELLER_REVIEWS_PATH;
}

interface PaginationInput {
  query: SellerReviewsPageQuery;
  total: number;
  limit: number;
}

// `totalPages` tối thiểu 1. Trang hiện tại có thể VƯỢT totalPages (gõ tay ?page=99, hoặc trả lời xong đánh giá
// cuối của trang cuối ở tab "Chưa trả lời" làm trang đó biến mất) — "Trang trước" khi đó nhảy thẳng về trang cuối
// thật thay vì page - 1 (vẫn rỗng).
export function buildSellerReviewsPagination({ query, total, limit }: PaginationInput): {
  totalPages: number;
  prevHref: string;
  nextHref: string;
} {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    totalPages,
    prevHref: buildSellerReviewsHref({
      ...query,
      page: Math.max(1, Math.min(query.page - 1, totalPages)),
    }),
    nextHref: buildSellerReviewsHref({ ...query, page: Math.min(query.page + 1, totalPages) }),
  };
}
