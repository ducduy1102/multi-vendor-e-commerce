import { APPEAL_MESSAGE_MAX_LENGTH, createAppealSchema } from '@ecommerce/types';
import type { z } from 'zod';

// Form gửi kháng nghị dùng THẲNG schema của BE (packages/types): chuẩn hoá xuống dòng, cắt khoảng trắng hai đầu, 1..1000
// ký tự, chặn ký tự điều khiển — nên đầu ra của form luôn được BE chấp nhận. Message lỗi là key i18n `appeal.validation*`.
// Input và output cùng kiểu `string` nên khớp generic `useForm<T>` của zodResolver dù schema có transform
// (rules/frontend.md mục 4).
export { APPEAL_MESSAGE_MAX_LENGTH, createAppealSchema };
export type AppealFormInput = z.infer<typeof createAppealSchema>;
