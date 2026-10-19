// @vitest-environment node
import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { routing } from './routing';

// Chạy middleware next-intl THẬT với cấu hình `routing` thật (Week10.md 2.3). Kiểm hành vi chứ không kiểm
// giá trị cấu hình: bỏ `localeDetection: false` thì các ca "URL không prefix luôn là tiếng Việt" đỏ.
const middleware = createIntlMiddleware(routing);

function call(path: string, headers: Record<string, string> = {}) {
  const response = middleware(new NextRequest(`http://localhost${path}`, { headers }));
  const rewrite = response.headers.get('x-middleware-rewrite');
  return {
    status: response.status,
    location: response.headers.get('location'),
    // Locale next-intl đã chọn cho request (React render theo giá trị này).
    locale: response.headers.get('x-middleware-request-x-next-intl-locale'),
    // Đường dẫn nội bộ sau khi rewrite (vd "/vi/login"); null nếu không rewrite (URL đã có prefix locale, hoặc redirect).
    rewrittenPath: rewrite ? new URL(rewrite).pathname : null,
  };
}

const ENGLISH_BROWSER = { 'accept-language': 'en-US,en;q=0.9' };
const VIETNAMESE_BROWSER = { 'accept-language': 'vi-VN,vi;q=0.9' };
const COOKIE_EN = { cookie: 'NEXT_LOCALE=en' };

describe('routing — locale chỉ do URL quyết định (localeDetection: false)', () => {
  describe('URL không prefix luôn là tiếng Việt', () => {
    it.each([
      ['trình duyệt tiếng Anh (Accept-Language en-US)', ENGLISH_BROWSER],
      ['trình duyệt tiếng Việt', VIETNAMESE_BROWSER],
      ['cookie NEXT_LOCALE=en còn sót từ lần ghé /en trước', COOKIE_EN],
      ['cả Accept-Language en lẫn cookie en', { ...ENGLISH_BROWSER, ...COOKIE_EN }],
      ['không header nào', {}],
    ])('"/" với %s: KHÔNG redirect, phục vụ bản vi', (_label, headers) => {
      const result = call('/', headers);

      expect(result.location).toBeNull();
      expect(result.status).not.toBe(307);
      expect(result.locale).toBe('vi');
      expect(result.rewrittenPath).toBe('/vi');
    });

    it('trang con ("/login") với trình duyệt tiếng Anh: không bị đẩy sang /en/login', () => {
      const result = call('/login', ENGLISH_BROWSER);

      expect(result.location).toBeNull();
      expect(result.locale).toBe('vi');
      expect(result.rewrittenPath).toBe('/vi/login');
    });

    it('trang con với cookie en: vẫn tiếng Việt', () => {
      expect(call('/products', COOKIE_EN)).toMatchObject({
        location: null,
        locale: 'vi',
        rewrittenPath: '/vi/products',
      });
    });
  });

  describe('URL có prefix /en luôn là tiếng Anh, bất kể header/cookie', () => {
    it.each([
      ['Accept-Language vi', VIETNAMESE_BROWSER],
      ['cookie NEXT_LOCALE=vi', { cookie: 'NEXT_LOCALE=vi' }],
      ['không header nào', {}],
    ])(
      '"/en/login" với %s: giữ bản en (URL đã đúng locale nên không rewrite), không redirect',
      (_label, headers) => {
        expect(call('/en/login', headers)).toMatchObject({
          status: 200,
          location: null,
          locale: 'en',
          rewrittenPath: null,
        });
      },
    );

    it('"/en" (trang chủ tiếng Anh) mở thẳng được', () => {
      expect(call('/en', VIETNAMESE_BROWSER)).toMatchObject({
        status: 200,
        location: null,
        locale: 'en',
        rewrittenPath: null,
      });
    });
  });

  // LocaleSwitcher link tường minh "/vi/..." để chuyển về tiếng Việt: next-intl rút gọn về URL không prefix.
  describe('chuyển về tiếng Việt bằng link tường minh', () => {
    it('"/vi/login" được rút gọn về "/login" (redirect)', () => {
      const result = call('/vi/login', COOKIE_EN);

      expect(result.status).toBe(307);
      expect(new URL(result.location ?? '', 'http://localhost').pathname).toBe('/login');
    });
  });
});
