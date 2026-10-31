import type { AdminReport, AdminReportListResponse } from './types';

// Dữ liệu giả cho test hàng đợi báo cáo vi phạm (Week11.md 5.6). Mỗi builder trả đúng hình dạng của `adminReportSchema` cho một loại đối
// tượng; `overrides` ghi đè từng trường (kể cả `resolution`, `sameTargetOpenCount`, `createdAt`).
export const REPORT_ID = 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001';
export const REVIEW_ID = 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456';

const BASE = {
  id: REPORT_ID,
  targetId: REVIEW_ID,
  status: 'OPEN' as const,
  reasonCode: 'SPAM',
  note: 'Người này dán số Zalo bán hàng dưới mọi sản phẩm.',
  reporter: { name: 'Trần Minh Bảo', email: 'minhbao.tran@example.com' },
  createdAt: '2026-10-29T08:00:00.000Z',
  resolution: null,
  sameTargetOpenCount: 0,
};

type Overrides<T extends AdminReport['targetType']> = Partial<
  Extract<AdminReport, { targetType: T }>
>;

export function makeReviewReport(overrides: Overrides<'REVIEW'> = {}): AdminReport {
  return {
    ...BASE,
    targetType: 'REVIEW',
    snapshot: {
      productId: 'c9d8e7f6-1234-4a5b-8c9d-abcdef000009',
      productName: 'Áo thun cotton cổ tròn unisex',
      rating: 1,
      comment: 'Mua ở shop Linh Linh rẻ hơn 30%, ib Zalo 0901 234 567 để được giá sỉ nhé.',
      authorName: 'Nguyễn Văn Anh',
    },
    ...overrides,
  };
}

export function makeShopReport(overrides: Overrides<'SHOP'> = {}): AdminReport {
  return {
    ...BASE,
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000002',
    targetId: 'd1e2f3a4-1234-4a5b-8c9d-abcdef000010',
    targetType: 'SHOP',
    reasonCode: 'COUNTERFEIT',
    note: null,
    snapshot: { name: 'Shop Hàng Hiệu Giá Sỉ', slug: 'hang-hieu-gia-si' },
    ...overrides,
  };
}

export function makeProductReport(overrides: Overrides<'PRODUCT'> = {}): AdminReport {
  return {
    ...BASE,
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000003',
    targetId: 'e1f2a3b4-1234-4a5b-8c9d-abcdef000011',
    targetType: 'PRODUCT',
    reasonCode: 'PROHIBITED_ITEM',
    snapshot: { name: 'Dao bấm tự động lò xo 21cm', shopName: 'Tạp Hoá Nam Anh' },
    ...overrides,
  };
}

export function makeConversationReport(overrides: Overrides<'CONVERSATION'> = {}): AdminReport {
  return {
    ...BASE,
    id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000004',
    targetId: 'f1a2b3c4-1234-4a5b-8c9d-abcdef000012',
    targetType: 'CONVERSATION',
    reasonCode: 'HARASSMENT',
    note: null,
    snapshot: { shopName: 'Gia Dụng Xinh', buyerName: 'Nguyễn Thị Hồng', reporterRole: 'SHOP' },
    ...overrides,
  };
}

// Báo cáo ĐÃ xử lý bằng một hành động (mặc định: ẩn đánh giá).
export function makeResolvedReport(
  overrides: Partial<AdminReport> = {},
  resolution: Partial<NonNullable<AdminReport['resolution']>> = {},
): AdminReport {
  return {
    ...makeReviewReport(),
    status: 'RESOLVED',
    resolution: {
      action: 'HIDE_REVIEW',
      note: 'Ngôn từ xúc phạm người bán.',
      resolvedByName: 'Quản trị Lan',
      resolvedAt: '2026-10-29T10:00:00.000Z',
      ...resolution,
    },
    ...overrides,
  } as AdminReport;
}

// Báo cáo SẢN PHẨM ĐÃ xử lý (mặc định: gỡ sản phẩm). `resolution` dựng tường minh ở đây vì `makeResolvedReport({ ...makeProductReport() })` sẽ
// ghi đè nó bằng `resolution: null` của báo cáo gốc.
export function makeResolvedProductReport(
  overrides: Partial<AdminReport> = {},
  resolution: Partial<NonNullable<AdminReport['resolution']>> = {},
): AdminReport {
  return {
    ...makeProductReport(),
    status: 'RESOLVED',
    resolution: {
      action: 'TAKE_DOWN_PRODUCT',
      note: 'Hàng cấm: dao bấm tự động.',
      resolvedByName: 'Quản trị Lan',
      resolvedAt: '2026-10-29T10:00:00.000Z',
      ...resolution,
    },
    ...overrides,
  } as AdminReport;
}

// Báo cáo SHOP ĐÃ xử lý (mặc định: khoá shop). `resolution` dựng tường minh vì spread của builder khác sẽ ghi đè nó bằng null.
export function makeResolvedShopReport(
  overrides: Partial<AdminReport> = {},
  resolution: Partial<NonNullable<AdminReport['resolution']>> = {},
): AdminReport {
  return {
    ...makeShopReport(),
    status: 'RESOLVED',
    resolution: {
      action: 'SUSPEND_SHOP',
      note: 'Bán hàng giả, vi phạm nhiều lần.',
      resolvedByName: 'Quản trị Lan',
      resolvedAt: '2026-10-29T10:00:00.000Z',
      ...resolution,
    },
    ...overrides,
  } as AdminReport;
}

export function makeReportPage(
  items: AdminReport[],
  overrides: Partial<Omit<AdminReportListResponse, 'items'>> = {},
): AdminReportListResponse {
  return { items, total: items.length, page: 1, limit: 20, ...overrides };
}
