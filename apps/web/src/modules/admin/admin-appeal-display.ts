import { ADMIN_APPEAL_LIST_FILTERS } from '@ecommerce/types';

import type { AdminShopBadgeTone } from './admin-status-display';
import type { AdminAppealListFilter, AppealState } from './types';

// Cách hiển thị MỘT trạng thái kháng nghị ở hàng đợi của Admin: key i18n (namespace `admin`) + sắc thái huy hiệu. Bộ lọc của hàng
// đợi và trạng thái hiển thị của một dòng cùng là bốn giá trị (PENDING / ACCEPTED / REJECTED / CLOSED) nên dùng chung MỘT bảng:
// mỗi tab chỉ chứa dòng có đúng trạng thái đó. Chỉ token ngữ nghĩa (rules/frontend.md "UI polish" mục 2): `warning` cho việc cần
// Admin xử lý, `success` khi đã chấp nhận, từ chối / đã đóng chỉ là kết quả trung tính (`muted`) — giống tab "Từ chối" của shop.
export const ADMIN_APPEAL_STATE_DISPLAY: Record<
  AppealState,
  { labelKey: string; tabLabelKey: string; emptyKey: string; tone: AdminShopBadgeTone }
> = {
  PENDING: {
    labelKey: 'appealsStatePending',
    tabLabelKey: 'appealsTabPending',
    emptyKey: 'appealsEmptyPending',
    tone: 'warning',
  },
  ACCEPTED: {
    labelKey: 'appealsStateAccepted',
    tabLabelKey: 'appealsTabAccepted',
    emptyKey: 'appealsEmptyAccepted',
    tone: 'success',
  },
  REJECTED: {
    labelKey: 'appealsStateRejected',
    tabLabelKey: 'appealsTabRejected',
    emptyKey: 'appealsEmptyRejected',
    tone: 'muted',
  },
  CLOSED: {
    labelKey: 'appealsStateClosed',
    tabLabelKey: 'appealsTabClosed',
    emptyKey: 'appealsEmptyClosed',
    tone: 'muted',
  },
};

// Mặc định của BE (adminAppealListQuerySchema): hàng chờ xử lý. Tab này không cần `?status=` trên URL.
export const DEFAULT_ADMIN_APPEAL_FILTER: AdminAppealListFilter = 'PENDING';

// Thứ tự tab = thứ tự enum dùng chung (BE lọc theo cùng enum). Không có tab "Tất cả": BE luôn lọc theo đúng một bộ lọc.
export const ADMIN_APPEAL_TAB_FILTERS: readonly AdminAppealListFilter[] = ADMIN_APPEAL_LIST_FILTERS;
