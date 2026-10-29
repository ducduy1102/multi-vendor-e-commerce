import { appealStateSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import {
  ADMIN_APPEAL_STATE_DISPLAY,
  ADMIN_APPEAL_TAB_FILTERS,
  DEFAULT_ADMIN_APPEAL_FILTER,
} from './admin-appeal-display';

const STATES = appealStateSchema.options;

describe('ADMIN_APPEAL_STATE_DISPLAY', () => {
  it('phủ MỌI trạng thái kháng nghị — thêm trạng thái mới mà quên ánh xạ thì đỏ', () => {
    expect(Object.keys(ADMIN_APPEAL_STATE_DISPLAY).sort()).toEqual([...STATES].sort());
  });

  it.each(STATES)(
    '%s: nhãn, nhãn tab và câu rỗng đều có bản dịch ở cả vi lẫn en (namespace admin)',
    (state) => {
      const { labelKey, tabLabelKey, emptyKey } = ADMIN_APPEAL_STATE_DISPLAY[state];

      for (const key of [labelKey, tabLabelKey, emptyKey]) {
        expect(viMessages.admin[key as keyof typeof viMessages.admin], key).toEqual(
          expect.any(String),
        );
        expect(enMessages.admin[key as keyof typeof enMessages.admin], key).toEqual(
          expect.any(String),
        );
      }
    },
  );

  it('sắc thái: chờ = warning, chấp nhận = success, từ chối / đã đóng = trung tính (không dùng destructive cho kết quả)', () => {
    expect(ADMIN_APPEAL_STATE_DISPLAY.PENDING.tone).toBe('warning');
    expect(ADMIN_APPEAL_STATE_DISPLAY.ACCEPTED.tone).toBe('success');
    expect(ADMIN_APPEAL_STATE_DISPLAY.REJECTED.tone).toBe('muted');
    expect(ADMIN_APPEAL_STATE_DISPLAY.CLOSED.tone).toBe('muted');
  });
});

describe('tab của hàng đợi', () => {
  it('mặc định là hàng chờ xử lý, khớp mặc định của BE', () => {
    expect(DEFAULT_ADMIN_APPEAL_FILTER).toBe('PENDING');
  });

  it('có đúng bốn tab theo thứ tự enum dùng chung, tab đầu là mặc định', () => {
    expect([...ADMIN_APPEAL_TAB_FILTERS]).toEqual(['PENDING', 'ACCEPTED', 'REJECTED', 'CLOSED']);
    expect(ADMIN_APPEAL_TAB_FILTERS[0]).toBe(DEFAULT_ADMIN_APPEAL_FILTER);
  });
});
