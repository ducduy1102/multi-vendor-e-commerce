import { GoogleStrategy } from './google.strategy';

// Kiểm HÀNH VI THẬT của thư viện passport-oauth2 (nền của GoogleStrategy) thay vì suy luận:
// (1) option `state` truyền vào authenticate() có nằm trong URL sang Google không;
// (2) callback có `state` mà strategy không bật state store thì có bị từ chối không.
// Không gọi Google thật (cần OAuth client + trình duyệt) — chỉ kiểm phần của strategy.
describe('GoogleStrategy — tham số state mang next (Week7.md 1.2)', () => {
  type AuthenticatableStrategy = {
    redirect: jest.Mock;
    fail: jest.Mock;
    error: jest.Mock;
    authenticate: (req: unknown, options?: unknown) => void;
  };
  let strategy: AuthenticatableStrategy;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  beforeEach(() => {
    strategy = new GoogleStrategy() as unknown as AuthenticatableStrategy;
    strategy.redirect = jest.fn();
    strategy.fail = jest.fn();
    strategy.error = jest.fn();
  });

  it('có options.state — URL sang Google chứa đúng state', () => {
    strategy.authenticate({ query: {} }, { state: '/checkout' });

    expect(strategy.redirect).toHaveBeenCalledTimes(1);
    const url = new URL((strategy.redirect.mock.calls[0] as [string])[0]);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('state')).toBe('/checkout');
  });

  it('state kèm query được giữ nguyên qua URL encode', () => {
    strategy.authenticate(
      { query: {} },
      { state: '/cart?voucherCode=SALE10&x=1' },
    );

    const url = new URL((strategy.redirect.mock.calls[0] as [string])[0]);
    expect(url.searchParams.get('state')).toBe('/cart?voucherCode=SALE10&x=1');
  });

  it('không có options.state — URL sang Google không có tham số state (hành vi cũ)', () => {
    strategy.authenticate({ query: {} }, undefined);

    const url = new URL((strategy.redirect.mock.calls[0] as [string])[0]);
    expect(url.searchParams.has('state')).toBe(false);
  });

  it('callback mang state nhưng không bật state store — strategy KHÔNG đòi/kiểm state (không lỗi session)', () => {
    // Nếu strategy có state store thì req không có session sẽ gọi error()/fail(); ở đây chỉ được
    // đi tiếp bước đổi code lấy token (gọi Google — không chạy ở test), tức không fail sớm.
    strategy.authenticate(
      { query: { code: 'abc', state: '/checkout' } },
      undefined,
    );

    expect(strategy.fail).not.toHaveBeenCalled();
    expect(strategy.error).not.toHaveBeenCalled();
  });
});
