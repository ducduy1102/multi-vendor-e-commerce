import { REPORT_REASON_CODES_BY_TARGET, REPORT_TARGET_TYPES } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { REPORT_REASON_MESSAGE_KEYS } from '@/shared/lib/report-reason-labels';
import { REPORT_TARGET_TITLE_KEYS } from './report-display';

const MESSAGES = { vi: viMessages.report, en: enMessages.report } as Record<
  'vi' | 'en',
  Record<string, string>
>;

describe('report-display — nhãn lý do và tiêu đề theo loại đối tượng', () => {
  it('mọi loại đối tượng đều có tiêu đề hộp thoại ở cả hai ngôn ngữ, và các tiêu đề khác nhau', () => {
    const keys = REPORT_TARGET_TYPES.map((type) => REPORT_TARGET_TITLE_KEYS[type]);

    expect(new Set(keys).size).toBe(REPORT_TARGET_TYPES.length);
    for (const key of keys) {
      for (const locale of ['vi', 'en'] as const) {
        expect(MESSAGES[locale][key], `${locale}.report.${key}`).toBeTruthy();
      }
    }
  });

  it('mọi lý do mà BE chấp nhận cho từng loại đều hiển thị được (không có mã nằm ngoài bảng nhãn)', () => {
    for (const type of REPORT_TARGET_TYPES) {
      for (const code of REPORT_REASON_CODES_BY_TARGET[type]) {
        expect(REPORT_REASON_MESSAGE_KEYS[code]).toBeDefined();
      }
    }
  });
});
