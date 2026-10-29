import { appealStateSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { APPEAL_BADGE_CLASS, APPEAL_STATE_DISPLAY } from './appeal-display';

const STATES = appealStateSchema.options;

describe('APPEAL_STATE_DISPLAY', () => {
  it('phủ MỌI trạng thái kháng nghị — thêm trạng thái mới mà quên ánh xạ thì đỏ', () => {
    expect(Object.keys(APPEAL_STATE_DISPLAY).sort()).toEqual([...STATES].sort());
  });

  it.each(STATES)('%s: nhãn có bản dịch ở cả vi lẫn en (namespace appeal)', (state) => {
    const { labelKey } = APPEAL_STATE_DISPLAY[state];

    expect(viMessages.appeal[labelKey as keyof typeof viMessages.appeal]).toEqual(
      expect.any(String),
    );
    expect(enMessages.appeal[labelKey as keyof typeof enMessages.appeal]).toEqual(
      expect.any(String),
    );
  });

  it('sắc thái theo ý nghĩa: chờ = warning, chấp nhận = success, từ chối = destructive, đã đóng = trung tính', () => {
    expect(APPEAL_STATE_DISPLAY.PENDING.tone).toBe('warning');
    expect(APPEAL_STATE_DISPLAY.ACCEPTED.tone).toBe('success');
    expect(APPEAL_STATE_DISPLAY.REJECTED.tone).toBe('destructive');
    expect(APPEAL_STATE_DISPLAY.CLOSED.tone).toBe('muted');
  });

  it('mỗi sắc thái có lớp huy hiệu, chỉ dùng token ngữ nghĩa (không màu thô)', () => {
    for (const tone of ['warning', 'success', 'destructive', 'muted'] as const) {
      const { className } = APPEAL_BADGE_CLASS[tone];

      expect(className).not.toMatch(
        /#[0-9a-f]{3,8}|\b(?:red|green|blue|amber|neutral|gray)-\d{2,3}\b/i,
      );
    }
  });

  it('huy hiệu destructive dùng nền trắng + viền nhạt (nền hồng nhạt chỉ đạt 3,97:1 ở chế độ sáng)', () => {
    expect(APPEAL_BADGE_CLASS.destructive.className).toContain('bg-background');
    expect(APPEAL_BADGE_CLASS.destructive.className).toContain('border-destructive/30');
  });
});
