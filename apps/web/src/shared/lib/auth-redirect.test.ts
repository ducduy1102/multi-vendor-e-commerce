import { describe, expect, it } from 'vitest';

import { decideAuthRedirect, PROTECTED_PATH_PREFIXES, readSessionState } from './auth-redirect';

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

    it('/account và các trang con -> /login?next=<đúng trang đó> (đăng nhập xong quay lại đúng chỗ, Week9.md 6.2)', () => {
      expect(decideAuthRedirect({ pathname: '/account', search: '', isAuthenticated: false })).toBe(
        '/login?next=%2Faccount',
      );
      expect(
        decideAuthRedirect({ pathname: '/account/addresses', search: '', isAuthenticated: false }),
      ).toBe('/login?next=%2Faccount%2Faddresses');
      expect(
        decideAuthRedirect({ pathname: '/account/password', search: '', isAuthenticated: false }),
      ).toBe('/login?next=%2Faccount%2Fpassword');
    });

    it('đã đăng nhập vào /account/* -> không redirect', () => {
      expect(
        decideAuthRedirect({
          pathname: '/account/addresses',
          search: '',
          isAuthenticated: true,
          role: 'USER',
        }),
      ).toBeNull();
    });

    it('/accountevil -> không phải route /account (không khớp tiền tố), không bị chặn', () => {
      expect(
        decideAuthRedirect({ pathname: '/accountevil', search: '', isAuthenticated: false }),
      ).toBeNull();
    });

    it('/chat và /chat?c=<id> -> next giữ nguyên query (đăng nhập xong quay lại đúng hội thoại)', () => {
      const conversationId = '3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c';

      expect(decideAuthRedirect({ pathname: '/chat', search: '', isAuthenticated: false })).toBe(
        '/login?next=%2Fchat',
      );
      expect(
        decideAuthRedirect({
          pathname: '/chat',
          search: `?c=${conversationId}`,
          isAuthenticated: false,
        }),
      ).toBe(`/login?next=${encodeURIComponent(`/chat?c=${conversationId}`)}`);
    });

    it('đã đăng nhập vào /chat -> không redirect', () => {
      expect(
        decideAuthRedirect({ pathname: '/chat', search: '', isAuthenticated: true, role: 'USER' }),
      ).toBeNull();
    });

    it('/chatter -> không phải route /chat (không khớp tiền tố), không bị chặn', () => {
      expect(
        decideAuthRedirect({ pathname: '/chatter', search: '', isAuthenticated: false }),
      ).toBeNull();
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

  describe('/forgot-password và /reset-password (Week9.md 6.1)', () => {
    // Không guest-only: người đang đăng nhập bằng Google dùng chính luồng này để đặt mật khẩu lần đầu.
    it.each(['/forgot-password', '/reset-password'])(
      '%s -> không redirect dù đã đăng nhập (kể cả có ?token=)',
      (pathname) => {
        expect(
          decideAuthRedirect({
            pathname,
            search: '?token=abc',
            isAuthenticated: true,
            role: 'USER',
          }),
        ).toBeNull();
      },
    );

    // Không protected: người quên mật khẩu chắc chắn chưa đăng nhập được.
    it.each(['/forgot-password', '/reset-password'])(
      '%s -> không redirect khi là guest',
      (pathname) => {
        expect(
          decideAuthRedirect({ pathname, search: '?token=abc', isAuthenticated: false }),
        ).toBeNull();
      },
    );
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

// Hai vị từ phiên (Week10.md 2.1): access_token (15 phút) quyết định "đã đăng nhập thật" cho route CHỈ DÀNH
// CHO KHÁCH; access_token HOẶC refresh_token (7 ngày) quyết định "còn dấu vết phiên" cho route CẦN ĐĂNG NHẬP.
describe('decideAuthRedirect — hai vị từ phiên', () => {
  describe('chỉ còn refresh_token (access_token đã hết hạn và bị trình duyệt xoá)', () => {
    const refreshOnly = { isAuthenticated: false, hasSessionTrace: true };

    it.each(PROTECTED_PATH_PREFIXES.filter((prefix) => prefix !== '/admin'))(
      '%s -> KHÔNG redirect (để client kịp gia hạn phiên thay vì bị đẩy ra /login)',
      (prefix) => {
        expect(
          decideAuthRedirect({ pathname: prefix, search: '', role: 'USER', ...refreshOnly }),
        ).toBeNull();
      },
    );

    it('/orders và /seller/products -> được vào', () => {
      expect(decideAuthRedirect({ pathname: '/orders', search: '', ...refreshOnly })).toBeNull();
      expect(
        decideAuthRedirect({ pathname: '/seller/products', search: '', ...refreshOnly }),
      ).toBeNull();
    });

    it('refresh_token của ADMIN -> vào được /admin/* (role đọc từ refresh_token)', () => {
      expect(
        decideAuthRedirect({
          pathname: '/admin/shops',
          search: '',
          role: 'ADMIN',
          ...refreshOnly,
        }),
      ).toBeNull();
    });

    it('refresh_token của USER -> /admin/* vẫn bị đẩy về "/"', () => {
      expect(
        decideAuthRedirect({
          pathname: '/admin/shops',
          search: '',
          role: 'USER',
          ...refreshOnly,
        }),
      ).toBe('/');
    });

    it('refresh_token không đọc được role -> /admin/* về "/" (không mặc định cho vào)', () => {
      expect(
        decideAuthRedirect({ pathname: '/admin', search: '', role: null, ...refreshOnly }),
      ).toBe('/');
    });

    it.each(['/login', '/register'])(
      'refresh_token cũ/đã thu hồi + KHÔNG có access_token -> %s vẫn vào được (không bị đẩy đi mãi, không khoá người dùng khỏi đăng nhập lại)',
      (pathname) => {
        expect(decideAuthRedirect({ pathname, search: '', ...refreshOnly })).toBeNull();
        expect(
          decideAuthRedirect({
            pathname,
            search: `?next=${encodeURIComponent('/orders')}`,
            ...refreshOnly,
          }),
        ).toBeNull();
      },
    );
  });

  describe('không có cookie nào', () => {
    it('route cần đăng nhập -> /login?next=', () => {
      expect(
        decideAuthRedirect({
          pathname: '/orders',
          search: '',
          isAuthenticated: false,
          hasSessionTrace: false,
        }),
      ).toBe('/login?next=%2Forders');
    });
  });

  describe('có access_token', () => {
    it('không truyền hasSessionTrace -> mặc định bằng isAuthenticated (tương thích ngược)', () => {
      expect(
        decideAuthRedirect({ pathname: '/orders', search: '', isAuthenticated: true }),
      ).toBeNull();
      expect(decideAuthRedirect({ pathname: '/login', search: '', isAuthenticated: true })).toBe(
        '/',
      );
    });
  });
});

describe('readSessionState', () => {
  // JWT giả chỉ cần payload đọc được: header.payload.signature, payload là base64url của { sub, role }.
  const jwtWithRole = (role: string) =>
    `h.${btoa(JSON.stringify({ sub: 'u1', role }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.s`;

  it('không cookie nào -> không đăng nhập, không dấu vết, không role', () => {
    expect(readSessionState({})).toEqual({
      isAuthenticated: false,
      hasSessionTrace: false,
      role: null,
    });
  });

  it('chỉ access_token -> đăng nhập + có dấu vết, role từ access_token', () => {
    expect(readSessionState({ accessToken: jwtWithRole('ADMIN') })).toEqual({
      isAuthenticated: true,
      hasSessionTrace: true,
      role: 'ADMIN',
    });
  });

  it('chỉ refresh_token -> KHÔNG coi là đăng nhập thật nhưng còn dấu vết; role đọc từ refresh_token', () => {
    expect(readSessionState({ refreshToken: jwtWithRole('SELLER') })).toEqual({
      isAuthenticated: false,
      hasSessionTrace: true,
      role: 'SELLER',
    });
  });

  it('có cả hai -> role ưu tiên access_token', () => {
    expect(
      readSessionState({ accessToken: jwtWithRole('ADMIN'), refreshToken: jwtWithRole('USER') }),
    ).toMatchObject({ role: 'ADMIN' });
  });

  it('access_token hỏng -> rơi về role của refresh_token', () => {
    expect(
      readSessionState({ accessToken: 'khong-phai-jwt', refreshToken: jwtWithRole('ADMIN') }),
    ).toMatchObject({ isAuthenticated: true, role: 'ADMIN' });
  });

  it('cookie rỗng coi như không có', () => {
    expect(readSessionState({ accessToken: '', refreshToken: '' })).toEqual({
      isAuthenticated: false,
      hasSessionTrace: false,
      role: null,
    });
  });
});
