import { shopStatusSchema } from '@ecommerce/types';

import type { ShopStatus } from './types';

// Cách hiển thị 1 trạng thái shop: key i18n (namespace `admin`) + sắc thái Badge. Chỉ token ngữ nghĩa
// (rules/frontend.md "UI polish" mục 2): `warning` cho việc cần Admin xử lý (chờ duyệt), `success`
// cho shop đang bán, `destructive` cho shop bị khoá (cần chú ý), từ chối chỉ là kết quả trung tính
// (`muted`). Accent (cam) không dùng cho trạng thái.
export type AdminShopBadgeTone = 'warning' | 'success' | 'destructive' | 'muted';

// `dateLabelKey`: nhãn của cột ngày — cột này hiện `statusChangedAt` (mốc VÀO trạng thái hiện tại, cũng là khoá
// sắp xếp của mọi tab) nên nhãn nói đúng sự kiện: "Chờ từ" (hàng chờ), "Duyệt lúc", "Từ chối lúc", "Khoá lúc".
export const ADMIN_SHOP_STATUS_DISPLAY: Record<
  ShopStatus,
  { labelKey: string; emptyKey: string; dateLabelKey: string; tone: AdminShopBadgeTone }
> = {
  PENDING: {
    labelKey: 'statusPending',
    emptyKey: 'emptyStatePending',
    dateLabelKey: 'columnWaitingSince',
    tone: 'warning',
  },
  APPROVED: {
    labelKey: 'statusApproved',
    emptyKey: 'emptyStateApproved',
    dateLabelKey: 'columnApprovedAt',
    tone: 'success',
  },
  REJECTED: {
    labelKey: 'statusRejected',
    emptyKey: 'emptyStateRejected',
    dateLabelKey: 'columnRejectedAt',
    tone: 'muted',
  },
  SUSPENDED: {
    labelKey: 'statusSuspended',
    emptyKey: 'emptyStateSuspended',
    dateLabelKey: 'columnSuspendedAt',
    tone: 'destructive',
  },
};

// Mặc định của BE (adminShopListQuerySchema): hàng chờ duyệt. Tab này không cần `?status=` trên URL.
export const DEFAULT_ADMIN_SHOP_STATUS: ShopStatus = 'PENDING';

// Thứ tự tab = thứ tự enum dùng chung (BE lọc theo cùng enum). Không có tab "Tất cả" vì BE luôn lọc
// theo đúng 1 trạng thái.
export const ADMIN_SHOP_TAB_STATUSES: readonly ShopStatus[] = shopStatusSchema.options;
