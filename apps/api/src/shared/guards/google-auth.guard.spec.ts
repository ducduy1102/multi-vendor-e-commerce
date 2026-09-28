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
      state: '/checkout',
    });
  });

  it('next hợp lệ kèm query', () => {
    expect(
      guard.getAuthenticateOptions(
        contextWithQuery({ next: '/cart?voucherCode=SALE10' }),
      ),
    ).toEqual({ state: '/cart?voucherCode=SALE10' });
  });

  it('không có next — hành vi cũ (không truyền option nào)', () => {
    expect(guard.getAuthenticateOptions(contextWithQuery({}))).toBeUndefined();
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
