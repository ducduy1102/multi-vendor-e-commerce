import type { ReportTargetType } from '@ecommerce/types';

// Khoá dịch (namespace `report`) của tiêu đề hộp thoại theo loại đối tượng. `satisfies Record<...>` làm việc thêm một loại vào
// `REPORT_TARGET_TYPES` mà quên tiêu đề trở thành LỖI BIÊN DỊCH; `report-display.test.ts` kiểm thêm rằng mọi khoá có thật trong vi.json
// và en.json. Bảng nhãn LÝ DO nằm ở `shared/lib/report-reason-labels.ts` (dùng chung với `modules/admin`).
export const REPORT_TARGET_TITLE_KEYS = {
  REVIEW: 'titleReview',
  CONVERSATION: 'titleConversation',
  SHOP: 'titleShop',
  PRODUCT: 'titleProduct',
} as const satisfies Record<ReportTargetType, string>;
