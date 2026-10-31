import {
  ADMIN_REPORT_LIST_FILTERS,
  reportActionsFor,
  type AdminReport,
  type ReportResolutionAction,
  type ReportTargetType,
} from '@ecommerce/types';
import { MessageCircle, Package, Star, Store, type LucideIcon } from 'lucide-react';

import type { AdminShopBadgeTone } from './admin-status-display';
import type { AdminReportListFilter } from './types';

// Bảng hiển thị của hàng đợi báo cáo vi phạm (Week11.md 5.6). Khoá i18n thuộc namespace `admin`; nhãn LÝ DO báo cáo dùng namespace
// `report` qua `shared/lib/report-reason-labels.ts`.

export const DEFAULT_ADMIN_REPORT_FILTER: AdminReportListFilter = 'OPEN';

export const ADMIN_REPORT_TAB_FILTERS: readonly AdminReportListFilter[] = ADMIN_REPORT_LIST_FILTERS;

export const ADMIN_REPORT_TAB_DISPLAY: Record<
  AdminReportListFilter,
  { tabLabelKey: string; emptyKey: string; emptyHintKey: string }
> = {
  OPEN: {
    tabLabelKey: 'reportsTabOpen',
    emptyKey: 'reportsEmptyOpen',
    emptyHintKey: 'reportsEmptyOpenHint',
  },
  CLOSED: {
    tabLabelKey: 'reportsTabClosed',
    emptyKey: 'reportsEmptyClosed',
    emptyHintKey: 'reportsEmptyClosedHint',
  },
};

export const ADMIN_REPORT_TYPE_DISPLAY = {
  REVIEW: { icon: Star, labelKey: 'reportsTypeReview' },
  CONVERSATION: { icon: MessageCircle, labelKey: 'reportsTypeConversation' },
  SHOP: { icon: Store, labelKey: 'reportsTypeShop' },
  PRODUCT: { icon: Package, labelKey: 'reportsTypeProduct' },
} as const satisfies Record<ReportTargetType, { icon: LucideIcon; labelKey: string }>;

// Báo cáo ĐANG MỞ quá ngưỡng này gắn nhãn "Chờ lâu". Trạng thái SUY TỪ GIỜ (không lưu ở DB): sàn chưa có quy định SLA nào nên 48 giờ là
// mốc do chủ dự án chốt (Week11.md 5.6), đổi ở đây một nơi.
export const ADMIN_REPORT_SLOW_AFTER_MS = 48 * 60 * 60 * 1000;

export function isAdminReportSlow(
  report: Pick<AdminReport, 'status' | 'createdAt'>,
  now: number,
): boolean {
  // Ngày sai dạng cho NaN, và `NaN >= x` là false: một dòng hỏng không bao giờ bị gắn nhãn nhầm.
  return (
    report.status === 'OPEN' && now - Date.parse(report.createdAt) >= ADMIN_REPORT_SLOW_AFTER_MS
  );
}

// --- Hành động xử lý -------------------------------------------------------------------------------

// Hành động mà BE ĐÃ CẮM bộ xử lý (AdminReportsService.handlers). `BLOCK_BUYER` (bước 6.2) chưa có bộ xử lý nên BE trả 409
// `REPORT_ACTION_NOT_ALLOWED`: ẩn khỏi danh sách thay vì hiện nút xám. Cắm thêm bộ xử lý ở BE thì thêm hành động vào ĐÚNG HAI nơi: mảng
// này và `ADMIN_REPORT_ACTION_COPY` (kiểu `Record` theo mảng này — quên nhãn là lỗi biên dịch).
export const ADMIN_PLUGGED_REPORT_ACTIONS = [
  'HIDE_REVIEW',
  'SUSPEND_SHOP',
  'TAKE_DOWN_PRODUCT',
  'SUSPEND_REPORTED_USER',
  'DISMISS',
] as const satisfies readonly ReportResolutionAction[];

export type AdminPluggedReportAction = (typeof ADMIN_PLUGGED_REPORT_ACTIONS)[number];

export interface AdminReportActionCopy {
  // Lựa chọn trong panel Xử lý.
  labelKey: string;
  descriptionKey: string;
  // Nút mở hộp thoại xác nhận (có dấu … vì còn một bước nữa).
  submitKey: string;
  // Hộp thoại xác nhận.
  confirmTitleKey: string;
  confirmDescriptionKey: string;
  confirmKey: string;
  // Câu nói ai nhìn thấy ghi chú (null = ghi chú không bắt buộc và không hiện cho ai).
  noteVisibilityKey: string | null;
  // Hành động mang tính hạn chế/huỷ bỏ ⇒ nút viền cảnh báo + nút xác nhận đỏ đặc (rules/frontend.md mục 11); Bỏ qua thì trung tính.
  isCautionary: boolean;
}

export const ADMIN_REPORT_ACTION_COPY: Record<AdminPluggedReportAction, AdminReportActionCopy> = {
  HIDE_REVIEW: {
    labelKey: 'reportActionHideReview',
    descriptionKey: 'reportActionHideReviewDescription',
    submitKey: 'reportSubmitHideReview',
    confirmTitleKey: 'reportConfirmHideReviewTitle',
    confirmDescriptionKey: 'reportConfirmHideReviewDescription',
    confirmKey: 'reportConfirmHideReview',
    noteVisibilityKey: 'reportNoteVisibleToAuthorAndShop',
    isCautionary: true,
  },
  SUSPEND_SHOP: {
    labelKey: 'reportActionSuspendShop',
    descriptionKey: 'reportActionSuspendShopDescription',
    submitKey: 'reportSubmitSuspendShop',
    confirmTitleKey: 'reportConfirmSuspendShopTitle',
    confirmDescriptionKey: 'reportConfirmSuspendShopDescription',
    confirmKey: 'reportConfirmSuspendShop',
    noteVisibilityKey: 'reportNoteVisibleToShop',
    isCautionary: true,
  },
  TAKE_DOWN_PRODUCT: {
    labelKey: 'reportActionTakeDownProduct',
    descriptionKey: 'reportActionTakeDownProductDescription',
    submitKey: 'reportSubmitTakeDownProduct',
    confirmTitleKey: 'reportConfirmTakeDownProductTitle',
    confirmDescriptionKey: 'reportConfirmTakeDownProductDescription',
    confirmKey: 'reportConfirmTakeDownProduct',
    // Ghi chú xử lý làm LÝ DO gỡ và hiện cho chủ shop (trang sửa, danh sách sản phẩm, thông báo) — cùng câu với khoá shop.
    noteVisibilityKey: 'reportNoteVisibleToShop',
    isCautionary: true,
  },
  SUSPEND_REPORTED_USER: {
    labelKey: 'reportActionSuspendUser',
    descriptionKey: 'reportActionSuspendUserDescription',
    submitKey: 'reportSubmitSuspendUser',
    confirmTitleKey: 'reportConfirmSuspendUserTitle',
    confirmDescriptionKey: 'reportConfirmSuspendUserDescription',
    confirmKey: 'reportConfirmSuspendUser',
    noteVisibilityKey: 'reportNoteVisibleToUser',
    isCautionary: true,
  },
  DISMISS: {
    labelKey: 'reportActionDismiss',
    descriptionKey: 'reportActionDismissDescription',
    submitKey: 'reportSubmitDismiss',
    confirmTitleKey: 'reportConfirmDismissTitle',
    confirmDescriptionKey: 'reportConfirmDismissDescription',
    confirmKey: 'reportConfirmDismiss',
    noteVisibilityKey: null,
    isCautionary: false,
  },
};

// Các hành động Admin chọn được cho MỘT báo cáo: tập hợp lệ theo loại (và vai người báo của hội thoại) từ hợp đồng dùng chung, rồi lọc
// những hành động BE đã cắm — đúng thứ tự của hợp đồng (hành động chính trước, "Bỏ qua" cuối).
export function availableAdminReportActions(report: AdminReport): AdminPluggedReportAction[] {
  const role = report.targetType === 'CONVERSATION' ? report.snapshot.reporterRole : undefined;
  return reportActionsFor(report.targetType, role).filter(
    (action): action is AdminPluggedReportAction =>
      (ADMIN_PLUGGED_REPORT_ACTIONS as readonly string[]).includes(action),
  );
}

// --- Kết quả đã xử lý ------------------------------------------------------------------------------

const RESULT_DISPLAY: Record<
  ReportResolutionAction,
  { labelKey: string; tone: AdminShopBadgeTone }
> = {
  HIDE_REVIEW: { labelKey: 'reportResultHideReview', tone: 'success' },
  SUSPEND_SHOP: { labelKey: 'reportResultSuspendShop', tone: 'success' },
  TAKE_DOWN_PRODUCT: { labelKey: 'reportResultTakeDownProduct', tone: 'success' },
  SUSPEND_REPORTED_USER: { labelKey: 'reportResultSuspendUser', tone: 'success' },
  BLOCK_BUYER: { labelKey: 'reportResultBlockBuyer', tone: 'success' },
  DISMISS: { labelKey: 'reportResultDismiss', tone: 'muted' },
};

// `resolution.action` là chuỗi thường (hợp đồng): hành động mà FE chưa biết rơi về nhãn chung thay vì làm hỏng cả danh sách.
export function describeAdminReportResult(action: string): {
  labelKey: string;
  tone: AdminShopBadgeTone;
} {
  return Object.prototype.hasOwnProperty.call(RESULT_DISPLAY, action)
    ? RESULT_DISPLAY[action as ReportResolutionAction]
    : { labelKey: 'reportResultUnknown', tone: 'muted' };
}

// Chỉ báo cáo ĐÁNH GIÁ đã xử lý bằng "Ẩn đánh giá" mới mở lại được (POST /admin/reviews/:id/unhide).
export function canReopenReportedReview(report: AdminReport): boolean {
  return (
    report.targetType === 'REVIEW' &&
    report.status === 'RESOLVED' &&
    report.resolution?.action === 'HIDE_REVIEW'
  );
}

// Chỉ báo cáo SẢN PHẨM đã xử lý bằng "Gỡ sản phẩm" mới khôi phục được (POST /admin/products/:id/restore).
export function canRestoreReportedProduct(report: AdminReport): boolean {
  return (
    report.targetType === 'PRODUCT' &&
    report.status === 'RESOLVED' &&
    report.resolution?.action === 'TAKE_DOWN_PRODUCT'
  );
}

// Đối tượng bị báo ĐÃ mất trang công khai vì chính kết quả xử lý của báo cáo này: sản phẩm bị gỡ (trang sản phẩm trả 404) hoặc shop bị khoá (trang
// shop chỉ có với shop APPROVED nên cũng 404). Thẻ "Nội dung bị báo" dùng kết quả này để thay link trần dẫn Admin tới trang 404 bằng nhãn nói rõ lý do.
// Chỉ suy được từ KẾT QUẢ của báo cáo: báo cáo không mang trạng thái HIỆN TẠI của đối tượng (mở khoá / khôi phục ở nơi khác thì nhãn có thể cũ).
export type AdminReportGoneTarget = 'PRODUCT_TAKEN_DOWN' | 'SHOP_SUSPENDED';

export function reportedTargetGone(report: AdminReport): AdminReportGoneTarget | null {
  const action = report.resolution?.action;
  if (report.targetType === 'PRODUCT' && action === 'TAKE_DOWN_PRODUCT')
    return 'PRODUCT_TAKEN_DOWN';
  if (report.targetType === 'SHOP' && action === 'SUSPEND_SHOP') return 'SHOP_SUSPENDED';
  return null;
}

// Hai việc "hoàn tác" của Admin trên một báo cáo ĐÃ xử lý, mỗi loại đối tượng một việc: mở lại đánh giá đã ẩn, khôi phục sản phẩm đã gỡ.
export type AdminReportRevertKind = 'REVIEW' | 'PRODUCT';

export function revertKindOf(report: AdminReport): AdminReportRevertKind | null {
  if (canReopenReportedReview(report)) return 'REVIEW';
  if (canRestoreReportedProduct(report)) return 'PRODUCT';
  return null;
}

// Chữ của từng việc hoàn tác (khoá thuộc namespace `admin`): nút ở thẻ kết quả + câu giải thích, hộp thoại nhập lý do, và câu báo xong.
export interface AdminReportRevertCopy {
  buttonKey: string;
  hintKey: string;
  titleKey: string;
  descriptionKey: string;
  reasonLabelKey: string;
  confirmKey: string;
  doneKey: string;
}

export const ADMIN_REPORT_REVERT_COPY: Record<AdminReportRevertKind, AdminReportRevertCopy> = {
  REVIEW: {
    buttonKey: 'reportReopenButton',
    hintKey: 'reportReopenHint',
    titleKey: 'reportReopenTitle',
    descriptionKey: 'reportReopenDescription',
    reasonLabelKey: 'reportReopenReasonLabel',
    confirmKey: 'reportReopenConfirm',
    doneKey: 'reportReopenDone',
  },
  PRODUCT: {
    buttonKey: 'reportRestoreProductButton',
    hintKey: 'reportRestoreProductHint',
    titleKey: 'reportRestoreProductTitle',
    descriptionKey: 'reportRestoreProductDescription',
    reasonLabelKey: 'reportRestoreProductReasonLabel',
    confirmKey: 'reportRestoreProductConfirm',
    doneKey: 'reportRestoreProductDone',
  },
};

// --- Tên đối tượng bị báo --------------------------------------------------------------------------

// Tên hiển thị của đối tượng, suy từ ảnh chụp lúc báo. Không có chữ nào cần dịch (số sao, tên riêng, mũi tên) nên là hàm thuần.
export function adminReportTargetTitle(report: AdminReport): string {
  switch (report.targetType) {
    case 'REVIEW':
      return `${report.snapshot.rating}★ · ${report.snapshot.productName}`;
    case 'CONVERSATION':
      return `${report.snapshot.buyerName} ↔ ${report.snapshot.shopName}`;
    case 'SHOP':
    case 'PRODUCT':
      return report.snapshot.name;
    default: {
      const unhandled: never = report;
      throw new Error(`Unhandled report ${JSON.stringify(unhandled)}`);
    }
  }
}
