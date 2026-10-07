import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useFormatAdminDate } from './useFormatAdminDate';

// Giữa trưa UTC để ngày không đổi qua hầu hết múi giờ (hàm cố ý dùng múi giờ của trình duyệt), nên chỉ
// khẳng định phần không phụ thuộc múi giờ: năm và tên tháng theo locale.
const NOON_UTC = '2026-10-01T12:00:00.000Z';

function formatWith(locale: 'vi' | 'en', isoDate: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale}>{children}</NextIntlClientProvider>
  );
  const { result } = renderHook(() => useFormatAdminDate(), { wrapper });
  return result.current(isoDate);
}

describe('useFormatAdminDate', () => {
  it('vi: tháng kiểu tiếng Việt', () => {
    const text = formatWith('vi', NOON_UTC);

    expect(text).toContain('2026');
    expect(text).toMatch(/thg 10/);
  });

  it('en: tên tháng tiếng Anh', () => {
    const text = formatWith('en', NOON_UTC);

    expect(text).toContain('2026');
    expect(text).toMatch(/Oct/);
  });

  it('chỉ có NGÀY, không có giờ (danh sách shop không cần giờ)', () => {
    expect(formatWith('vi', NOON_UTC)).not.toMatch(/\d{1,2}:\d{2}/);
    expect(formatWith('en', NOON_UTC)).not.toMatch(/(AM|PM)/);
  });
});
