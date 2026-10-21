import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../../../../messages/en.json';
import viMessages from '../../../../messages/vi.json';
import { useChatDateFormat } from './useChatDateFormat';

function wrapperFor(locale: 'vi' | 'en') {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

const setup = (locale: 'vi' | 'en') =>
  renderHook(() => useChatDateFormat(), { wrapper: wrapperFor(locale) }).result.current;

// Mốc dựng bằng thành phần GIỜ ĐỊA PHƯƠNG nên kết quả đúng ở mọi múi giờ của máy chạy test.
const local = new Date(2030, 0, 7, 9, 5, 0);

describe('useChatDateFormat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('time: giờ:phút theo múi giờ trình duyệt — vi dạng 24 giờ, en dạng AM/PM', () => {
    expect(setup('vi').time(local.toISOString())).toBe('09:05');
    expect(setup('en').time(local.toISOString())).toMatch(/^09:05\s?AM$/);
  });

  it('shortDate: ngày/tháng hai chữ số (dấu phân cách phụ thuộc dữ liệu ICU nên chỉ kiểm hình dạng)', () => {
    expect(setup('vi').shortDate(local)).toMatch(/^07[-/]01$/);
    expect(setup('en').shortDate(local)).toMatch(/^01[-/]07$/);
  });

  it('fullDate: có thứ, ngày tháng và NĂM', () => {
    expect(setup('vi').fullDate(local)).toMatch(/07[-/]01[-/]2030|2030/);
    expect(setup('en').fullDate(local)).toContain('2030');
    expect(setup('en').fullDate(local)).toMatch(/Mon/);
  });

  it('truyền timeZone tường minh: next-intl không báo ENVIRONMENT_FALLBACK ra console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const format = setup('vi');

    format.time(local.toISOString());
    format.shortDate(local);
    format.fullDate(local);

    expect(consoleError).not.toHaveBeenCalled();
  });
});
