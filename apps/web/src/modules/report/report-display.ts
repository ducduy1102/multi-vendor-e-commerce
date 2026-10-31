import type { ReportReasonCode, ReportTargetType } from '@ecommerce/types';

// Khoá dịch (namespace `report`) của từng mã lý do và từng loại đối tượng. `satisfies Record<...>` làm việc thêm một mã vào
// `REPORT_REASON_CODES` / `REPORT_TARGET_TYPES` mà quên nhãn trở thành LỖI BIÊN DỊCH; `report-display.test.ts` kiểm thêm rằng mọi
// khoá có thật trong vi.json và en.json.
export const REPORT_REASON_MESSAGE_KEYS = {
  SPAM: 'reasonSpam',
  OFFENSIVE_LANGUAGE: 'reasonOffensiveLanguage',
  FAKE_REVIEW: 'reasonFakeReview',
  PERSONAL_INFO: 'reasonPersonalInfo',
  IRRELEVANT: 'reasonIrrelevant',
  HARASSMENT: 'reasonHarassment',
  SCAM: 'reasonScam',
  COUNTERFEIT: 'reasonCounterfeit',
  PROHIBITED_ITEM: 'reasonProhibitedItem',
  MISLEADING_INFO: 'reasonMisleadingInfo',
  OFFENSIVE_CONTENT: 'reasonOffensiveContent',
  OTHER: 'reasonOther',
} as const satisfies Record<ReportReasonCode, string>;

export const REPORT_TARGET_TITLE_KEYS = {
  REVIEW: 'titleReview',
  CONVERSATION: 'titleConversation',
  SHOP: 'titleShop',
  PRODUCT: 'titleProduct',
} as const satisfies Record<ReportTargetType, string>;
