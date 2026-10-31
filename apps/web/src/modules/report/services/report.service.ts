import {
  createReportResponseSchema,
  type CreateReportInput,
  type ReportReceipt,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

// Gửi báo cáo vi phạm. Người báo lấy từ phiên; body chỉ có đối tượng (`targetType` + `targetId`), lý do và ghi chú tuỳ chọn.
// Trả biên nhận tối thiểu (id, loại, trạng thái, mốc tạo) — người báo không có route nào để xem lại báo cáo, kết quả đến qua thông
// báo chung chung. Lỗi có mã nghiệp vụ: 404 `REPORT_TARGET_NOT_FOUND` (không tồn tại / không thấy được / không phải thành viên — MỘT
// mã cho cả ba), 409 `REPORT_OWN_CONTENT` / `REPORT_ALREADY_OPEN`, 429 `REPORT_LIMIT_REACHED`, 403 `EMAIL_NOT_VERIFIED`.
export async function createReport(input: CreateReportInput): Promise<ReportReceipt> {
  const data = await apiFetch<unknown>('/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return createReportResponseSchema.parse(data).report;
}
