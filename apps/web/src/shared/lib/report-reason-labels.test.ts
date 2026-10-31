import { REPORT_REASON_CODES } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { REPORT_REASON_MESSAGE_KEYS, reportReasonMessageKey } from './report-reason-labels';

const MESSAGES = { vi: viMessages.report, en: enMessages.report } as Record<
  'vi' | 'en',
  Record<string, string>
>;

describe('report-reason-labels', () => {
  it('mọi mã lý do của hợp đồng đều có khoá dịch, và mọi khoá đều có thật ở cả vi lẫn en', () => {
    for (const code of REPORT_REASON_CODES) {
      const key = REPORT_REASON_MESSAGE_KEYS[code];
      expect(key, `thiếu khoá cho ${code}`).toBeTruthy();
      for (const locale of ['vi', 'en'] as const) {
        expect(MESSAGES[locale][key], `${locale}.report.${key}`).toBeTruthy();
      }
    }
  });

  it('nhãn tiếng Việt và tiếng Anh của cùng một lý do không trùng nhau (không để sót bản dịch)', () => {
    for (const code of REPORT_REASON_CODES) {
      const key = REPORT_REASON_MESSAGE_KEYS[code];
      expect(MESSAGES.vi[key]).not.toBe(MESSAGES.en[key]);
    }
  });

  it('reportReasonMessageKey: mã đã biết trả đúng khoá', () => {
    expect(reportReasonMessageKey('SPAM')).toBe('reasonSpam');
    expect(reportReasonMessageKey('OTHER')).toBe('reasonOther');
  });

  it.each(['', 'UNKNOWN_CODE', 'toString', '__proto__', 'constructor', 'hasOwnProperty'])(
    'reportReasonMessageKey: mã lạ %j trả null (không rơi vào thuộc tính của Object)',
    (code) => {
      expect(reportReasonMessageKey(code)).toBeNull();
    },
  );
});
