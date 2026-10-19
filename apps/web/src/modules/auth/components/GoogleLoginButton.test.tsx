import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { API_BASE_URL, API_PREFIX } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { GoogleLoginButton } from './GoogleLoginButton';

const GOOGLE_URL = `${API_BASE_URL}${API_PREFIX}/auth/google`;

function hrefOf(locale: 'vi' | 'en', next?: string): string | null {
  render(withIntl(<GoogleLoginButton next={next} />, locale));
  return screen.getByRole('button').getAttribute('href');
}

// OAuth redirect dựa trên trình duyệt: BE chỉ biết ngôn ngữ của trang bấm nút nếu FE gửi kèm — FE đặt
// `localeDetection: false` (Week10.md 2.3) nên URL không prefix luôn là tiếng Việt, không còn cookie nhớ.
describe('GoogleLoginButton — href tới BE', () => {
  it('vi, không next: URL trần như trước (vi là mặc định, không cần gửi)', () => {
    expect(hrefOf('vi')).toBe(GOOGLE_URL);
  });

  it('vi + next: chỉ có next, KHÔNG có locale', () => {
    expect(hrefOf('vi', '/checkout')).toBe(`${GOOGLE_URL}?next=%2Fcheckout`);
  });

  it('en, không next: gửi locale=en để BE redirect về /en', () => {
    expect(hrefOf('en')).toBe(`${GOOGLE_URL}?locale=en`);
  });

  it('en + next: gửi cả hai, next được encode', () => {
    expect(hrefOf('en', '/cart?voucherCode=SALE10')).toBe(
      `${GOOGLE_URL}?next=%2Fcart%3FvoucherCode%3DSALE10&locale=en`,
    );
  });
});
