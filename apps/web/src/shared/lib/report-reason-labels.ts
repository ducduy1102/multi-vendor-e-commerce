import type { ReportReasonCode } from '@ecommerce/types';

// Khoá dịch (namespace `report`) của từng mã lý do báo cáo. Dùng chung ≥ 2 module: `modules/report` (hộp thoại chọn lý do của người
// báo) và `modules/admin` (hiện lý do trên hàng đợi) — hai module lá không được import nhau nên bảng nhãn nằm ở `shared/`.
// `satisfies Record<...>` làm việc thêm một mã vào `REPORT_REASON_CODES` mà quên nhãn trở thành LỖI BIÊN DỊCH;
// `report-reason-labels.test.ts` kiểm thêm rằng mọi khoá có thật trong vi.json và en.json.
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

// `reasonCode` Admin nhận về là chuỗi thường (một mã BE thêm sau không làm hỏng cả danh sách): mã lạ trả `null` để nơi hiển thị rơi về
// nhãn chung thay vì ném lỗi hay in mã thô.
export function reportReasonMessageKey(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(REPORT_REASON_MESSAGE_KEYS, code)
    ? REPORT_REASON_MESSAGE_KEYS[code as ReportReasonCode]
    : null;
}
