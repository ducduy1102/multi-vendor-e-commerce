import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { GoogleProfile } from './types/google-profile.type';

// Chỉ kiểm nhánh redirect của Google OAuth callback (Week7.md 1.2/2.2b): `next` đi vòng qua
// trình duyệt và Google nên phải được kiểm lại ở callback.
describe('AuthController.googleCallback', () => {
  const FRONTEND = 'http://frontend.test';
  let authService: { loginWithGoogle: jest.Mock };
  let controller: AuthController;
  let res: { redirect: jest.Mock; cookie: jest.Mock };

  const profile = {
    googleId: 'g1',
    email: 'a@b.c',
    name: 'A',
  };
  const callback = (query: Record<string, unknown>) =>
    controller.googleCallback(
      { user: profile, query } as unknown as Request & { user: GoogleProfile },
      res as unknown as Response,
    );

  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
    authService = {
      loginWithGoogle: jest
        .fn()
        .mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    };
    controller = new AuthController(authService as unknown as AuthService);
    res = { redirect: jest.fn(), cookie: jest.fn() };
  });

  afterAll(() => {
    delete process.env.FRONTEND_URL;
  });

  describe('đăng nhập thành công', () => {
    it('không có state — hành vi cũ: redirect về đúng FRONTEND_URL, đã set cookie', async () => {
      await callback({});

      expect(res.redirect).toHaveBeenCalledWith(FRONTEND);
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('state hợp lệ — redirect tới FRONTEND_URL + next', async () => {
      await callback({ state: '/checkout' });

      expect(res.redirect).toHaveBeenCalledWith(`${FRONTEND}/checkout`);
    });

    it('state hợp lệ kèm query — giữ nguyên query', async () => {
      await callback({ state: '/cart?voucherCode=SALE10' });

      expect(res.redirect).toHaveBeenCalledWith(
        `${FRONTEND}/cart?voucherCode=SALE10`,
      );
    });

    it.each([
      ['open redirect //', '//evil.com'],
      ['URL tuyệt đối', 'https://evil.com/checkout'],
      ['ngoài allow-list', '/login'],
      ['%2f%2f', '%2f%2fevil.com'],
      ['CRLF', '/checkout%0d%0aSet-Cookie:x=1'],
      ['mảng', ['/checkout', '//evil.com']],
    ])(
      'state bẩn (%s) — bỏ qua, redirect về trang chủ, không bao giờ ra ngoài FRONTEND_URL',
      async (_l, state) => {
        await callback({ state });

        expect(res.redirect).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith(FRONTEND);
      },
    );
  });

  describe('đăng nhập lỗi', () => {
    it('không có state — hành vi cũ: /login?error=google_login_failed', async () => {
      authService.loginWithGoogle.mockRejectedValue(new Error('boom'));

      await callback({});

      expect(res.redirect).toHaveBeenCalledWith(
        `${FRONTEND}/login?error=google_login_failed`,
      );
    });

    it('tài khoản bị khoá — error=account_not_active', async () => {
      authService.loginWithGoogle.mockRejectedValue(
        new UnauthorizedException('ACCOUNT_NOT_ACTIVE'),
      );

      await callback({});

      expect(res.redirect).toHaveBeenCalledWith(
        `${FRONTEND}/login?error=account_not_active`,
      );
    });

    it('có state hợp lệ — giữ next (đã encode) ở nhánh lỗi', async () => {
      authService.loginWithGoogle.mockRejectedValue(new Error('boom'));

      await callback({ state: '/cart?voucherCode=SALE10' });

      expect(res.redirect).toHaveBeenCalledWith(
        `${FRONTEND}/login?error=google_login_failed&next=${encodeURIComponent('/cart?voucherCode=SALE10')}`,
      );
    });

    it('state bẩn — không đưa vào nhánh lỗi', async () => {
      authService.loginWithGoogle.mockRejectedValue(new Error('boom'));

      await callback({ state: '//evil.com' });

      expect(res.redirect).toHaveBeenCalledWith(
        `${FRONTEND}/login?error=google_login_failed`,
      );
    });
  });
});
