import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useFormatOrderDate } from './useFormatOrderDate';

// Giữa trưa UTC để ngày không đổi qua hầu hết múi giờ (hàm cố ý dùng múi giờ của trình duyệt), nên chỉ
// khẳng định phần không phụ thuộc múi giờ: năm, tên tháng theo locale và dạng giờ 24h/12h.
const NOON_UTC = '2026-10-01T12:00:00.000Z';

function formatWith(locale: 'vi' | 'en', isoDate: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale}>{children}</NextIntlClientProvider>
  );
  const { result } = renderHook(() => useFormatOrderDate(), { wrapper });
  return result.current(isoDate);
}

describe('useFormatOrderDate', () => {
  it('vi: tháng kiểu tiếng Việt và giờ 24h', () => {
    const text = formatWith('vi', NOON_UTC);

    expect(text).toContain('2026');
    expect(text).toMatch(/thg 10/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/AM|PM/);
  });

  it('en: tên tháng tiếng Anh và giờ 12h AM/PM — cùng 1 thời điểm, khác locale', () => {
    const text = formatWith('en', NOON_UTC);

    expect(text).toContain('2026');
    expect(text).toMatch(/Oct/);
    expect(text).toMatch(/(AM|PM)/);
  });

  it('có cả giờ lẫn ngày (khác bản của Admin chỉ có ngày)', () => {
    expect(formatWith('vi', NOON_UTC)).toMatch(/\d{1,2}:\d{2}/);
  });
});
