import {
  ArgumentsHost,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClearSessionCookiesFilter } from './clear-session-cookies.filter';

// Chỉ gắn vào POST /auth/refresh (Week10.md 2.1): bị từ chối mà request thật sự có gửi cookie refresh_token
// thì xoá luôn cả hai cookie phiên; không có cookie thì KHÔNG đụng tới cookie nào (logout CSRF).
describe('ClearSessionCookiesFilter', () => {
  let filter: ClearSessionCookiesFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let clearCookie: jest.Mock;

  const catchWith = (
    exception: UnauthorizedException,
    cookies: Record<string, string> | undefined,
  ) => {
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ cookies }),
        getResponse: () => ({ status, clearCookie }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
  };

  beforeEach(() => {
    delete process.env.COOKIE_DOMAIN;
    filter = new ClearSessionCookiesFilter();
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    clearCookie = jest.fn();
  });

  afterEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  it('có gửi cookie refresh_token + bị từ chối ⇒ xoá CẢ HAI cookie phiên, vẫn trả 401 đúng format chuẩn', () => {
    catchWith(new UnauthorizedException(), { refresh_token: 'stale' });

    expect(clearCookie).toHaveBeenCalledTimes(2);
    expect(clearCookie.mock.calls.map(([name]) => name as string)).toEqual([
      'access_token',
      'refresh_token',
    ]);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      data: null,
      message: 'Unauthorized',
    });
  });

  it('xoá bằng đúng option lúc đặt cookie (Domain/Path/SameSite/HttpOnly khớp hệt, không maxAge) — lệch một thuộc tính là trình duyệt không xoá', () => {
    process.env.COOKIE_DOMAIN = '.chot.store';

    catchWith(new UnauthorizedException(), { refresh_token: 'stale' });

    for (const [, options] of clearCookie.mock.calls as [
      string,
      Record<string, unknown>,
    ][]) {
      expect(options).toMatchObject({
        domain: '.chot.store',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
      });
      expect(options).not.toHaveProperty('maxAge');
    }
  });

  it('request KHÔNG gửi cookie refresh_token ⇒ 401 trơn, KHÔNG xoá cookie nào (request cross-site không kích hoạt được logout CSRF)', () => {
    catchWith(new UnauthorizedException(), {});

    expect(clearCookie).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('chỉ gửi access_token (không có refresh_token) ⇒ không xoá', () => {
    catchWith(new UnauthorizedException(), { access_token: 'x' });

    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('cookie refresh_token rỗng ⇒ không xoá', () => {
    catchWith(new UnauthorizedException(), { refresh_token: '' });

    expect(clearCookie).not.toHaveBeenCalled();
  });

  it('không có cookie-parser (req.cookies undefined) ⇒ không ném lỗi, không xoá', () => {
    expect(() =>
      catchWith(new UnauthorizedException(), undefined),
    ).not.toThrow();

    expect(clearCookie).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('chỉ bắt UnauthorizedException (lỗi khác không đi qua filter này)', () => {
    const catches = Reflect.getMetadata(
      '__filterCatchExceptions__',
      ClearSessionCookiesFilter,
    ) as unknown[];

    expect(catches).toEqual([UnauthorizedException]);
    expect(catches).not.toContain(NotFoundException);
  });
});
