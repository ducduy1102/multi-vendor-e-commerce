import type { ExecutionContext } from '@nestjs/common';
import { GoogleAuthGuard } from './google-auth.guard';

function contextWithQuery(query: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
}

describe('GoogleAuthGuard.getAuthenticateOptions', () => {
  const guard = new GoogleAuthGuard();

  it('next hợp lệ — truyền qua tham số OAuth `state`', () => {
    expect(
      guard.getAuthenticateOptions(contextWithQuery({ next: '/checkout' })),
    ).toEqual({
      state: 'n=%2Fcheckout',
    });
  });

  it('next hợp lệ kèm query', () => {
    expect(
      guard.getAuthenticateOptions(
        contextWithQuery({ next: '/cart?voucherCode=SALE10' }),
      ),
    ).toEqual({ state: 'n=%2Fcart%3FvoucherCode%3DSALE10' });
  });

  it('không có next và không có locale — hành vi cũ (không truyền option nào)', () => {
    expect(guard.getAuthenticateOptions(contextWithQuery({}))).toBeUndefined();
  });

  // Week10.md 2.3: ngôn ngữ của trang bấm nút đi vòng qua Google để callback redirect về đúng prefix.
  describe('locale', () => {
    it('chỉ có locale=en — state mang ngôn ngữ', () => {
      expect(
        guard.getAuthenticateOptions(contextWithQuery({ locale: 'en' })),
      ).toEqual({ state: 'l=en' });
    });

    it('next + locale=en — mang cả hai', () => {
      expect(
        guard.getAuthenticateOptions(
          contextWithQuery({ next: '/checkout', locale: 'en' }),
        ),
      ).toEqual({ state: 'n=%2Fcheckout&l=en' });
    });

    it('locale=vi (mặc định) — không thêm gì vào state', () => {
      expect(
        guard.getAuthenticateOptions(
          contextWithQuery({ next: '/checkout', locale: 'vi' }),
        ),
      ).toEqual({ state: 'n=%2Fcheckout' });
      expect(
        guard.getAuthenticateOptions(contextWithQuery({ locale: 'vi' })),
      ).toBeUndefined();
    });

    it.each([
      ['ngôn ngữ lạ', 'fr'],
      ['chèn đường dẫn', '/en'],
      ['URL', 'https://evil.com'],
      ['mảng', ['en', 'vi']],
      ['object', { a: 'en' }],
      ['chuỗi rỗng', ''],
    ])('locale bẩn (%s) bị bỏ, không lọt vào state', (_label, locale) => {
      expect(
        guard.getAuthenticateOptions(contextWithQuery({ locale })),
      ).toBeUndefined();
    });
  });

  it.each([
    ['open redirect', '//evil.com'],
    ['URL tuyệt đối', 'https://evil.com'],
    ['ngoài allow-list', '/login'],
    ['CRLF', '/checkout%0d%0aX:1'],
    ['mảng (?next=a&next=b)', ['/checkout', '/cart']],
    ['object (?next[a]=b)', { a: 'b' }],
  ])('next bẩn (%s) bị bỏ, không lọt vào state', (_label, next) => {
    expect(
      guard.getAuthenticateOptions(contextWithQuery({ next })),
    ).toBeUndefined();
  });
});
