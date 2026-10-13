import { listReviewsQuerySchema } from '@ecommerce/types';

export interface ReviewPageQuery {
  // Lọc theo số sao (1-5); undefined = tất cả.
  rating: number | undefined;
  page: number;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

// Param lặp (?reviewRating=4&reviewRating=5) ra mảng — chỉ lấy giá trị đầu, giống 1 param đơn.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Đọc `?reviewRating=&reviewPage=` từ searchParams của page.tsx (trang chi tiết sản phẩm). Tên param có
// tiền tố `review` để không đụng param khác của trang. URL do người dùng tự gõ/chỉnh nên KHÔNG tin: từng
// param sai dạng (số sao ngoài 1-5, trang không phải số dương) rơi về mặc định ĐỘC LẬP, không bao giờ ném
// lỗi làm sập trang. Dùng lại chính schema BE (rating/page coerce) để 2 phía không lệch luật.
export function parseReviewPageQuery(raw: RawSearchParams): ReviewPageQuery {
  const rating = listReviewsQuerySchema.shape.rating.safeParse(firstValue(raw.reviewRating));
  const page = listReviewsQuerySchema.shape.page.safeParse(firstValue(raw.reviewPage));
  return {
    rating: rating.success ? rating.data : undefined,
    page: page.success ? page.data : 1,
  };
}

// Đường dẫn trang sản phẩm kèm bộ lọc/trang đánh giá, neo `#reviews` để bấm lọc/chuyển trang vẫn ở đúng khối
// đánh giá thay vì nhảy lên đầu trang. Giá trị mặc định (tất cả sao, trang 1) không đưa lên URL.
export function buildReviewHref(productSlug: string, query: Partial<ReviewPageQuery>): string {
  const params = new URLSearchParams();
  if (query.rating !== undefined) params.set('reviewRating', String(query.rating));
  if (query.page !== undefined && query.page > 1) params.set('reviewPage', String(query.page));
  const search = params.toString();
  return `/products/${encodeURIComponent(productSlug)}${search ? `?${search}` : ''}#reviews`;
}
