import {
  createReportSchema,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_REASON_CODES_BY_TARGET,
} from '@ecommerce/types';
import type { z } from 'zod';

// Form báo cáo dùng THẲNG schema của BE (packages/types): lý do phải thuộc đúng loại đối tượng, chọn "Khác" thì bắt buộc mô tả,
// ghi chú được chuẩn hoá xuống dòng / cắt khoảng trắng / chặn ký tự điều khiển — nên đầu ra của form luôn được BE chấp nhận. Message
// lỗi là key i18n `report.validation*`. Ô ghi chú bỏ trống ("") được schema coi là chưa nhập, và input/output cùng kiểu nên khớp
// generic `useForm<T>` của zodResolver (rules/frontend.md mục 4).
export { createReportSchema, REPORT_NOTE_MAX_LENGTH, REPORT_REASON_CODES_BY_TARGET };
export type ReportFormInput = z.infer<typeof createReportSchema>;
