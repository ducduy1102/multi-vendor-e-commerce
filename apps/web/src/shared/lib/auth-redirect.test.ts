import { describe, expect, it } from 'vitest';

import { decideAuthRedirect, PROTECTED_PATH_PREFIXES } from './auth-redirect';

describe('decideAuthRedirect', () => {
  describe('guest vào route cần đăng nhập', () => {
    it.each(PROTECTED_PATH_PREFIXES)('%s -> /login?next=<chính path đó>', (prefix) => {
      const result = decideAuthRedirect({
        pathname: prefix,
        search: '',
        isAuthenticated: false,
      });
      expect(result).toBe(`/login?next=${encodeURIComponent(prefix)}`);
    });

    it('/checkout/result?groupId=1 -> next giữ nguyên cả path con lẫn query', () => {
      const result = decideAuthRedirect({
        pathname: '/checkout',
        search: '?groupId=1',
        isAuthenticated: false,
      });
      expect(result).toBe(`/login?next=${encodeURIComponent('/checkout?groupId=1')}`);
    });

    it('/seller/products -> next giữ nguyên path con', () => {
      const result = decideAuthRedirect({
        pathname: '/seller/products',
        search: '',
        isAuthenticated: false,
      });
      expect(result).toBe(`/login?next=${encodeURIComponent('/seller/products')}`);
    });
  });

  describe('guest vào route không cần đăng nhập', () => {
    it('/cart -> không redirect (giỏ hàng vẫn mở cho guest, Week6.md 1.16)', () => {
      expect(
        decideAuthRedirect({ pathname: '/cart', search: '', isAuthenticated: false }),
      ).toBeNull();
    });

    it('/login, /register -> không redirect', () => {
      expect(
        decideAuthRedirect({ pathname: '/login', search: '', isAuthenticated: false }),
      ).toBeNull();
      expect(
        decideAuthRedirect({ pathname: '/register', search: '', isAuthenticated: false }),
      ).toBeNull();
    });
  });

  describe('đã đăng nhập vào /login hoặc /register', () => {
    it('không có ?next= -> về "/"', () => {
      expect(decideAuthRedirect({ pathname: '/login', search: '', isAuthenticated: true })).toBe(
        '/',
      );
      expect(decideAuthRedirect({ pathname: '/register', search: '', isAuthenticated: true })).toBe(
        '/',
      );
    });

    it('?next= hợp lệ -> đi thẳng tới next (không phải "/")', () => {
      const result = decideAuthRedirect({
        pathname: '/login',
        search: '?next=%2Fcheckout',
        isAuthenticated: true,
      });
      expect(result).toBe('/checkout');
    });

    it('?next= độc hại (open redirect) -> bỏ, về "/"', () => {
      const result = decideAuthRedirect({
        pathname: '/login',
        search: `?next=${encodeURIComponent('//evil.com')}`,
        isAuthenticated: true,
      });
      expect(result).toBe('/');
    });

    it('?next= không nằm trong allow-list -> bỏ, về "/"', () => {
      const result = decideAuthRedirect({
        pathname: '/login',
        search: `?next=${encodeURIComponent('/admin')}`,
        isAuthenticated: true,
      });
      expect(result).toBe('/');
    });
  });

  describe('đã đăng nhập vào route bình thường', () => {
    it('/checkout -> không redirect (đã login, được vào)', () => {
      expect(
        decideAuthRedirect({ pathname: '/checkout', search: '', isAuthenticated: true }),
      ).toBeNull();
    });

    it('/ -> không redirect', () => {
      expect(decideAuthRedirect({ pathname: '/', search: '', isAuthenticated: true })).toBeNull();
    });
  });
});
