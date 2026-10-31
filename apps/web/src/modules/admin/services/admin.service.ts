import {
  adminAppealListResponseSchema,
  adminReportDetailResponseSchema,
  adminReportListResponseSchema,
  reviewModerationResponseSchema,
  adminCancelShopOrdersResultSchema,
  adminNoteCreatedResponseSchema,
  adminNoteListResponseSchema,
  adminOverviewSchema,
  adminRefundListResponseSchema,
  adminRefundRequestListResponseSchema,
  adminRefundRequestSchema,
  adminRefundSchema,
  adminRefundablePaymentListResponseSchema,
  adminShopListResponseSchema,
  adminShopSchema,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  adminUserStatusChangeResponseSchema,
  decideAppealResponseSchema,
  type AdminAppeal,
  type AdminAppealListQuery,
  type AdminAppealListResponse,
  type AdminCancelShopOrdersInput,
  type AdminCancelShopOrdersResult,
  type AdminDecideRefundRequestInput,
  type AdminMarkRefundCompletedInput,
  type AdminNote,
  type AdminNoteListQuery,
  type AdminNoteListResponse,
  type AdminOverview,
  type AdminRefund,
  type AdminRefundListQuery,
  type AdminRefundListResponse,
  type AdminRefundPaymentInput,
  type AdminRefundRequest,
  type AdminRefundRequestListQuery,
  type AdminRefundRequestListResponse,
  type AdminRefundablePaymentListQuery,
  type AdminRefundablePaymentListResponse,
  type AdminShop,
  type AdminShopListQuery,
  type AdminReport,
  type AdminReportListQuery,
  type AdminReportListResponse,
  type AdminShopListResponse,
  type AdminUpdateShopStatusInput,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type CreateAdminNoteInput,
  type DecideAppealInput,
  type ReactivateUserInput,
  type ResolveReportInput,
  type ReviewModerationResponse,
  type SuspendUserInput,
  type UnhideReviewInput,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Mọi danh sách của Admin chỉ lọc theo (tuỳ chọn) status + phân trang.
interface ListQueryParams {
  status?: string;
  page?: number;
  limit?: number;
}

// Field nào bỏ trống thì không gửi lên URL — để BE tự áp default (status, page=1, limit=20, xem các
// admin*ListQuerySchema), không lặp lại default ở FE (1 nguồn duy nhất, rules/general.md mục 4).
function toListQueryString(params: ListQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.status !== undefined) searchParams.set('status', params.status);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// Chỉ ADMIN gọi được (RolesGuard ở BE — 401 chưa đăng nhập, 403 không phải ADMIN).
export async function listShops(
  params: Partial<AdminShopListQuery> = {},
): Promise<AdminShopListResponse> {
  const data = await apiFetch<unknown>(`/admin/shops${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminShopListResponseSchema.parse(data);
}

// Số việc đang chờ Admin (Week11.md 2.5/2.6): shop chờ duyệt, khiếu nại đã lên sàn, khoản hoàn cần xử lý, thanh toán
// cần hoàn — mỗi số bằng `total` của tab tương ứng, BE đếm trực tiếp từ dữ liệu (không cache). Chỉ ADMIN gọi được.
export async function getOverview(): Promise<AdminOverview> {
  const data = await apiFetch<unknown>('/admin/overview', { method: 'GET' });
  return adminOverviewSchema.parse(data);
}

// Duyệt / từ chối / khoá / mở khoá. Từ chối và khoá bắt buộc `reason` (BE trả 400 nếu thiếu); shop
// không còn ở trạng thái hợp lệ để chuyển (đã có người xử lý) ⇒ 409 `SHOP_INVALID_TRANSITION`.
// BE bọc kết quả trong `{ shop }` (như PATCH /shops/:id).
export async function updateShopStatus(
  shopId: string,
  input: AdminUpdateShopStatusInput,
): Promise<AdminShop> {
  const data = await apiFetch<{ shop: unknown }>(`/admin/shops/${shopId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return adminShopSchema.parse(data.shop);
}

// Hủy hàng loạt đơn chưa giao của shop ĐANG bị khoá (Week11.md 4.1). Mỗi lần gọi xử lý tối đa một lô (BE giới hạn) — còn đơn thì
// `remaining > 0` và gọi lại. Shop không ở SUSPENDED ⇒ 409 `SHOP_NOT_SUSPENDED`; shop không tồn tại ⇒ 404.
export async function cancelShopOpenOrders(
  shopId: string,
  input: AdminCancelShopOrdersInput,
): Promise<AdminCancelShopOrdersResult> {
  const data = await apiFetch<unknown>(`/admin/shops/${shopId}/cancel-open-orders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminCancelShopOrdersResultSchema.parse(data);
}

// --- Người dùng (Week11.md 3.2, 3.3) ---------------------------------------------------------------

// Bộ lọc của danh sách người dùng. Khác toListQueryString (chỉ status/page/limit) ở chỗ có thêm vai và từ khoá; field nào
// bỏ trống thì không gửi để BE tự áp default.
function toUserListQueryString(params: Partial<AdminUserListQuery>): string {
  const searchParams = new URLSearchParams();
  if (params.status !== undefined) searchParams.set('status', params.status);
  if (params.role !== undefined) searchParams.set('role', params.role);
  if (params.q) searchParams.set('q', params.q);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function listUsers(
  params: Partial<AdminUserListQuery> = {},
): Promise<AdminUserListResponse> {
  const data = await apiFetch<unknown>(`/admin/users${toUserListQueryString(params)}`, {
    method: 'GET',
  });
  return adminUserListResponseSchema.parse(data);
}

// Chi tiết một người dùng: BE trả thẳng đối tượng chi tiết (không bọc). Id không tồn tại hoặc sai dạng ⇒ 404 USER_NOT_FOUND.
export async function getUser(userId: string): Promise<AdminUserDetail> {
  const data = await apiFetch<unknown>(`/admin/users/${userId}`, { method: 'GET' });
  return adminUserDetailSchema.parse(data);
}

// Tạm khoá hoặc cấm (`input.status` chọn mức), lý do bắt buộc. Tài khoản không còn ở trạng thái hợp lệ (có Admin khác vừa
// xử lý) ⇒ 409 USER_INVALID_TRANSITION; Admin/chính mình ⇒ 409 CANNOT_MODIFY_ADMIN / CANNOT_MODIFY_SELF. BE bọc kết quả
// trong { user } (người dùng SAU khi đổi).
export async function suspendUser(userId: string, input: SuspendUserInput): Promise<AdminUser> {
  const data = await apiFetch<unknown>(`/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminUserStatusChangeResponseSchema.parse(data).user;
}

// Mở lại (tạm khoá → hoạt động) hoặc gỡ cấm (cấm → hoạt động): cùng endpoint vì đích luôn là ACTIVE; lý do bắt buộc.
export async function reactivateUser(
  userId: string,
  input: ReactivateUserInput,
): Promise<AdminUser> {
  const data = await apiFetch<unknown>(`/admin/users/${userId}/reactivate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminUserStatusChangeResponseSchema.parse(data).user;
}

// --- Ghi chú nội bộ (Week11.md 4.3) ----------------------------------------------------------------

// Ghi chú của MỘT người dùng hoặc shop, mới nhất trước. Đối tượng không tồn tại ⇒ 404 `ADMIN_NOTE_TARGET_NOT_FOUND`. Cả
// `targetType` lẫn `targetId` đều bắt buộc (BE không có API đọc ghi chú toàn sàn).
export async function listAdminNotes(
  params: Pick<AdminNoteListQuery, 'targetType' | 'targetId'> & Partial<AdminNoteListQuery>,
): Promise<AdminNoteListResponse> {
  const searchParams = new URLSearchParams({
    targetType: params.targetType,
    targetId: params.targetId,
  });
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const data = await apiFetch<unknown>(`/admin/notes?${searchParams.toString()}`, {
    method: 'GET',
  });
  return adminNoteListResponseSchema.parse(data);
}

// Thêm một ghi chú (chỉ thêm, không sửa hay xoá được). Tác giả là Admin của phiên — không gửi trong body. BE bọc kết quả trong
// `{ note }`.
export async function createAdminNote(input: CreateAdminNoteInput): Promise<AdminNote> {
  const data = await apiFetch<unknown>('/admin/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminNoteCreatedResponseSchema.parse(data).note;
}

// --- Kháng nghị của shop (Week11.md 4.6) -----------------------------------------------------------

// Hàng đợi kháng nghị theo bộ lọc (mặc định PENDING: còn chờ VÀ lần khoá còn diễn ra; CLOSED: còn chờ nhưng lần khoá đã kết thúc).
// Mỗi dòng mang sẵn shop và chủ shop để quyết định mà không phải mở trang khác. Chỉ ADMIN gọi được.
export async function listAppeals(
  params: Partial<AdminAppealListQuery> = {},
): Promise<AdminAppealListResponse> {
  const data = await apiFetch<unknown>(`/admin/appeals${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminAppealListResponseSchema.parse(data);
}

// Chấp nhận (mở khoá shop ngay, ghi chú tuỳ chọn) hoặc từ chối (ghi chú BẮT BUỘC — BE trả 400 theo field `note`). Mỗi kháng nghị
// chỉ quyết định được MỘT lần: Admin khác đã quyết trước ⇒ 409 `APPEAL_ALREADY_DECIDED`; lần khoá đã kết thúc ⇒ 409
// `APPEAL_TARGET_CHANGED`; chấp nhận khi chủ shop đang bị khoá tài khoản ⇒ 409 `SHOP_OWNER_NOT_ACTIVE`. BE bọc kết quả trong
// `{ appeal }` (kháng nghị SAU khi quyết định).
export async function decideAppeal(
  appealId: string,
  input: DecideAppealInput,
): Promise<AdminAppeal> {
  const data = await apiFetch<unknown>(`/admin/appeals/${encodeURIComponent(appealId)}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return decideAppealResponseSchema.parse(data).appeal;
}

// --- Báo cáo vi phạm (Week11.md 5.4/5.6) -------------------------------------------------------------

// Hàng đợi báo cáo: tab `OPEN` (chờ xử lý, cũ nhất trước) hoặc `CLOSED` (đã xử lý, mới xử lý trước), lọc thêm theo loại đối tượng. Mỗi
// dòng mang sẵn ảnh chụp đối tượng lúc báo và số báo cáo mở khác về CÙNG đối tượng. Chỉ ADMIN gọi được.
export async function listReports(
  params: Partial<AdminReportListQuery> = {},
): Promise<AdminReportListResponse> {
  const searchParams = new URLSearchParams();
  if (params.status !== undefined) searchParams.set('status', params.status);
  if (params.targetType !== undefined) searchParams.set('targetType', params.targetType);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  const data = await apiFetch<unknown>(`/admin/reports${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
  return adminReportListResponseSchema.parse(data);
}

// Một báo cáo (id không tồn tại hoặc sai dạng ⇒ 404 `REPORT_NOT_FOUND`). BE bọc kết quả trong `{ report }`.
export async function getReport(reportId: string): Promise<AdminReport> {
  const data = await apiFetch<unknown>(`/admin/reports/${encodeURIComponent(reportId)}`, {
    method: 'GET',
  });
  return adminReportDetailResponseSchema.parse(data).report;
}

// Xử lý báo cáo THEO ĐỐI TƯỢNG: một hành động đóng luôn mọi báo cáo mở còn lại của đối tượng đó. Ghi chú bắt buộc trừ `DISMISS` (BE trả 400
// theo field `note`). Admin khác đã xử lý trước ⇒ 409 `REPORT_ALREADY_CLOSED`; hành động không dùng được cho loại này (hoặc chưa có bộ xử lý)
// ⇒ 409 `REPORT_ACTION_NOT_ALLOWED`; bên bị báo là Admin ⇒ 409 `CANNOT_MODIFY_ADMIN`. Trả báo cáo SAU khi xử lý.
export async function resolveReport(
  reportId: string,
  input: ResolveReportInput,
): Promise<AdminReport> {
  const data = await apiFetch<unknown>(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminReportDetailResponseSchema.parse(data).report;
}

// Mở lại một đánh giá đã ẩn (sửa nhầm). Lý do bắt buộc, chỉ ghi vào nhật ký quản trị. Đánh giá đang hiển thị ⇒ 409 `REVIEW_NOT_HIDDEN`.
export async function unhideReview(
  reviewId: string,
  input: UnhideReviewInput,
): Promise<ReviewModerationResponse> {
  const data = await apiFetch<unknown>(`/admin/reviews/${encodeURIComponent(reviewId)}/unhide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return reviewModerationResponseSchema.parse(data);
}

// --- Hoàn tiền (Week9.md 2.9) ---------------------------------------------------------------------
// Ba màn của Admin: hàng chờ khiếu nại, sổ cái hoàn tiền, thanh toán bất thường. Các cờ canApprove /
// canReject / canRetry / canMarkCompleted do BE tính — FE chỉ đọc. Mọi hành động trả lại CHÍNH dòng vừa
// đổi (yêu cầu hoặc khoản hoàn), không bọc trong `{ ... }`.

export async function listRefundRequests(
  params: Partial<AdminRefundRequestListQuery> = {},
): Promise<AdminRefundRequestListResponse> {
  const data = await apiFetch<unknown>(`/admin/refund-requests${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundRequestListResponseSchema.parse(data);
}

// Duyệt (ghi chú tuỳ chọn) hoặc từ chối (ghi chú BẮT BUỘC — BE trả 400 theo field `note`). Yêu cầu không
// còn ở trạng thái quyết định được (seller/Admin khác vừa xử lý, người mua vừa rút) ⇒ 409
// `REFUND_REQUEST_INVALID_TRANSITION`.
export async function decideRefundRequest(
  requestId: string,
  input: AdminDecideRefundRequestInput,
): Promise<AdminRefundRequest> {
  const data = await apiFetch<unknown>(`/admin/refund-requests/${requestId}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundRequestSchema.parse(data);
}

export async function listRefunds(
  params: Partial<AdminRefundListQuery> = {},
): Promise<AdminRefundListResponse> {
  const data = await apiFetch<unknown>(`/admin/refunds${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundListResponseSchema.parse(data);
}

// Gọi lại cổng cho khoản FAILED (hoặc PENDING bị bỏ dở quá 5 phút). Kết quả có thể vẫn FAILED/PENDING —
// vẫn là 200, FE đọc `status` của khoản trả về. 409 `PAYMENT_REFUND_NOT_RETRYABLE` = không còn ở trạng
// thái thử lại được (cờ `canRetry` đã cũ).
export async function retryRefund(refundId: string): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/refunds/${refundId}/retry`, { method: 'POST' });
  return adminRefundSchema.parse(data);
}

// Ghi nhận đã hoàn tay trên trang merchant của cổng: mã tham chiếu BẮT BUỘC (ghi thành
// 'MANUAL:<mã>'). Cùng điều kiện trạng thái với retry (409 `PAYMENT_REFUND_NOT_RETRYABLE`).
export async function markRefundCompleted(
  refundId: string,
  input: AdminMarkRefundCompletedInput,
): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/refunds/${refundId}/mark-completed`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundSchema.parse(data);
}

export async function listRefundablePayments(
  params: Partial<AdminRefundablePaymentListQuery> = {},
): Promise<AdminRefundablePaymentListResponse> {
  const data = await apiFetch<unknown>(`/admin/refundable-payments${toListQueryString(params)}`, {
    method: 'GET',
  });
  return adminRefundablePaymentListResponseSchema.parse(data);
}

// Hoàn một thanh toán bất thường (đến muộn sau khi đơn đã hủy / trả hai lần) — không đụng đơn hay kho. Lý
// do tuỳ chọn. 409 `PAYMENT_NOT_REFUNDABLE` = không còn bất thường (đã có khoản hoàn, nhóm có đơn sống...).
export async function refundPayment(
  paymentId: string,
  input: AdminRefundPaymentInput = {},
): Promise<AdminRefund> {
  const data = await apiFetch<unknown>(`/admin/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return adminRefundSchema.parse(data);
}
