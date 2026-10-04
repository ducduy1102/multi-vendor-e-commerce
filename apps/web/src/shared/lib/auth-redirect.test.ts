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

    it('/orders?tab=pending&page=2 và /orders/<id> -> next giữ nguyên query và path con (đăng nhập xong quay lại đúng tab/đơn)', () => {
      const list = decideAuthRedirect({
        pathname: '/orders',
        search: '?tab=pending&page=2',
        isAuthenticated: false,
      });
      const detail = decideAuthRedirect({
        pathname: '/orders/order-1',
        search: '',
        isAuthenticated: false,
      });
      expect(list).toBe(`/login?next=${encodeURIComponent('/orders?tab=pending&page=2')}`);
      expect(detail).toBe(`/login?next=${encodeURIComponent('/orders/order-1')}`);
    });

    it('/ordersevil -> không phải route /orders (không khớp tiền tố), không bị chặn', () => {
      expect(
        decideAuthRedirect({ pathname: '/ordersevil', search: '', isAuthenticated: false }),
      ).toBeNull();
    });

    it('/admin/shops?status=APPROVED&page=2 -> next giữ nguyên query (admin đăng nhập xong quay lại đúng tab/trang)', () => {
      const result = decideAuthRedirect({
        pathname: '/admin/shops',
        search: '?status=APPROVED&page=2',
        isAuthenticated: false,
      });
      expect(result).toBe(
        `/login?next=${encodeURIComponent('/admin/shops?status=APPROVED&page=2')}`,
      );
    });
  });

  describe('route /admin/* — chỉ ADMIN', () => {
    it.each(['/admin', '/admin/shops', '/admin/shops/anything'])(
      'đã đăng nhập, role USER vào %s -> đẩy về "/" (không lộ route tồn tại)',
      (pathname) => {
        expect(
          decideAuthRedirect({ pathname, search: '', isAuthenticated: true, role: 'USER' }),
        ).toBe('/');
      },
    );

    it.each([undefined, null, '', 'admin', 'SELLER'])(
      'đã đăng nhập nhưng role đọc được là %p (thiếu/lạ/sai hoa thường) -> coi như không phải ADMIN, về "/"',
      (role) => {
        expect(
          decideAuthRedirect({
            pathname: '/admin/shops',
            search: '',
            isAuthenticated: true,
            role,
          }),
        ).toBe('/');
      },
    );

    it.each(['/admin', '/admin/shops'])('role ADMIN vào %s -> được vào', (pathname) => {
      expect(
        decideAuthRedirect({ pathname, search: '', isAuthenticated: true, role: 'ADMIN' }),
      ).toBeNull();
    });

    it('guest vào /admin/shops -> về /login (kèm next), không phải "/" — guest chưa có role để xét', () => {
      expect(
        decideAuthRedirect({
          pathname: '/admin/shops',
          search: '',
          isAuthenticated: false,
          role: null,
        }),
      ).toBe(`/login?next=${encodeURIComponent('/admin/shops')}`);
    });

    it('/adminevil, /administrator -> không phải route /admin (không khớp tiền tố), không bị chặn', () => {
      for (const pathname of ['/adminevil', '/administrator']) {
        expect(
          decideAuthRedirect({ pathname, search: '', isAuthenticated: true, role: 'USER' }),
        ).toBeNull();
      }
    });

    it('route khác (vd /orders) không bị ảnh hưởng bởi role USER', () => {
      expect(
        decideAuthRedirect({
          pathname: '/orders',
          search: '',
          isAuthenticated: true,
          role: 'USER',
        }),
      ).toBeNull();
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
        search: `?next=${encodeURIComponent('/profile')}`,
        isAuthenticated: true,
      });
      expect(result).toBe('/');
    });

    it('?next=/admin/shops hợp lệ (allow-list có /admin) -> đi thẳng tới đó, việc xét role để lượt sau của proxy làm', () => {
      const result = decideAuthRedirect({
        pathname: '/login',
        search: `?next=${encodeURIComponent('/admin/shops')}`,
        isAuthenticated: true,
        role: 'ADMIN',
      });
      expect(result).toBe('/admin/shops');
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
