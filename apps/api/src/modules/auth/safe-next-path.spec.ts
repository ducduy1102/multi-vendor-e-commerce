import { safeNextPath, SAFE_NEXT_PATH_MAX_LENGTH } from '@ecommerce/types';

// `safeNextPath` (packages/types) là logic bảo mật — chống open redirect cho `?next=` (Week7.md 1.2).
// Test đặt ở apps/api vì packages/types chưa có test runner riêng.
describe('safeNextPath', () => {
  describe('đường dẫn hợp lệ — trả nguyên văn', () => {
    it.each([
      '/checkout',
      '/checkout/result',
      '/checkout/result?groupId=3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c',
      '/cart',
      '/cart?voucherCode=SALE10',
      '/seller/products',
      '/seller/products/abc/edit',
      '/wishlist',
      '/orders',
      '/orders?tab=pending&page=2',
      '/orders/3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c',
      '/products?page=2&categoryId=abc',
      '/products/ao-thun-nam',
      '/products/ao-thun%20nam',
      '/cart#top',
    ])('%s', (path) => {
      expect(safeNextPath(path)).toBe(path);
    });
  });

  describe('open redirect — bị từ chối', () => {
    it.each([
      ['protocol-relative', '//evil.com'],
      ['protocol-relative kèm path', '//evil.com/checkout'],
      ['backslash sau /', '/\\evil.com'],
      ['backslash trong path', '/checkout\\..\\evil'],
      ['URL tuyệt đối https', 'https://evil.com'],
      ['URL tuyệt đối http', 'http://evil.com/checkout'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['URL trá hình allow-list', 'https://evil.com/checkout'],
      ['%2f%2f (encode)', '%2f%2fevil.com'],
      ['%2F%2F (hoa)', '%2F%2Fevil.com'],
      ['/ rồi %2f', '/%2fevil.com'],
      ['/ rồi %2f + allow-list', '/%2fevil.com/checkout'],
      ['%5c (backslash encode)', '/%5cevil.com'],
      ['%5C hoa', '/%5Cevil.com'],
      ['double-encode %252f', '/%252fevil.com'],
      ['double-encode %255c', '/%255cevil.com'],
      ['CRLF encode %0d%0a', '/checkout%0d%0aSet-Cookie:a=b'],
      ['CRLF encode hoa', '/checkout%0D%0ALocation:https://evil.com'],
      ['xuống dòng thật', '/checkout\nhttps://evil.com'],
      ['tab thật', '/checkout\t'],
      ['null byte', '/checkout\u0000'],
      ['null byte encode', '/checkout%00'],
      ['thiếu / đầu', 'checkout'],
      ['khoảng trắng đầu', ' /checkout'],
      ['chỉ query', '?next=/checkout'],
      ['chỉ fragment', '#/checkout'],
    ])('%s: %s', (_label, value) => {
      expect(safeNextPath(value)).toBeNull();
    });
  });

  describe('dot-segment — không thoát khỏi allow-list', () => {
    it.each([
      '/checkout/../login',
      '/checkout/../../api/v1/auth/logout',
      '/cart/./../login',
      '/checkout/%2e%2e/login',
      '/checkout/%2E%2E/login',
      '/checkout/%252e%252e/login',
      '/seller/..',
    ])('%s', (value) => {
      expect(safeNextPath(value)).toBeNull();
    });
  });

  describe('ngoài allow-list — bị từ chối', () => {
    it.each([
      '/',
      '/login',
      '/login?next=/checkout',
      '/register',
      '/api',
      '/api/v1/auth/logout',
      '/verify-email?token=abc',
      '/en/checkout',
      '/vi/cart',
      '/checkoutevil',
      '/cartography',
      '/sellers',
      '/ordersevil',
      '/orders-evil.com',
      '/products-evil.com',
      '/admin',
    ])('%s', (value) => {
      expect(safeNextPath(value)).toBeNull();
    });
  });

  describe('đầu vào không phải chuỗi / rỗng / quá dài', () => {
    it.each([
      undefined,
      null,
      0,
      1,
      true,
      {},
      [],
      ['/checkout'],
      () => '/checkout',
    ])('%p', (value) => {
      expect(safeNextPath(value)).toBeNull();
    });

    it('chuỗi rỗng', () => {
      expect(safeNextPath('')).toBeNull();
    });

    it('đúng ngưỡng độ dài vẫn hợp lệ, vượt 1 ký tự thì bị từ chối', () => {
      const prefix = '/cart?q=';
      const atLimit =
        prefix + 'a'.repeat(SAFE_NEXT_PATH_MAX_LENGTH - prefix.length);
      expect(safeNextPath(atLimit)).toBe(atLimit);
      expect(safeNextPath(`${atLimit}a`)).toBeNull();
    });
  });

  it('encode hỏng (%zz, % cuối) — trả null, không ném lỗi', () => {
    expect(() => safeNextPath('/checkout?x=%zz')).not.toThrow();
    expect(safeNextPath('/checkout?x=%zz')).toBeNull();
    expect(safeNextPath('/checkout%')).toBeNull();
  });

  it('không bao giờ trả giá trị đã giải mã (chỉ trả nguyên văn hoặc null)', () => {
    const value = '/products/ao%20thun';
    expect(safeNextPath(value)).toBe(value);
  });
});
