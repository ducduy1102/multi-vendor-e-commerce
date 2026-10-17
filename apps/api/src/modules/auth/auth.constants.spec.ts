import { Controller, Get, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  clearTokenCookieOptions,
  refreshTokenCookieOptions,
} from './auth.constants';

const ENV_KEYS = ['COOKIE_DOMAIN', 'NODE_ENV'] as const;
let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  savedEnv = {
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  delete process.env.COOKIE_DOMAIN;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('cookie options (auth.constants)', () => {
  it.each([undefined, '', '   '])(
    'COOKIE_DOMAIN=%j: không có thuộc tính domain ở cả 3 hàm (cookie gắn với host của API)',
    (value) => {
      if (value !== undefined) process.env.COOKIE_DOMAIN = value;

      for (const options of [
        accessTokenCookieOptions(),
        refreshTokenCookieOptions(),
        clearTokenCookieOptions(),
      ]) {
        expect(options).not.toHaveProperty('domain');
      }
    },
  );

  it('COOKIE_DOMAIN=.chot.store (thừa khoảng trắng): domain đã trim, có ở cả 3 hàm', () => {
    process.env.COOKIE_DOMAIN = '  .chot.store  ';

    expect(accessTokenCookieOptions().domain).toBe('.chot.store');
    expect(refreshTokenCookieOptions().domain).toBe('.chot.store');
    expect(clearTokenCookieOptions().domain).toBe('.chot.store');
  });

  it.each([undefined, '.chot.store'])(
    'COOKIE_DOMAIN=%j: option xoá = option đặt bỏ maxAge (không thuộc tính nào lệch)',
    (value) => {
      if (value !== undefined) process.env.COOKIE_DOMAIN = value;

      const { maxAge: accessMaxAge, ...accessRest } =
        accessTokenCookieOptions();
      const { maxAge: refreshMaxAge, ...refreshRest } =
        refreshTokenCookieOptions();

      expect(accessMaxAge).toBeGreaterThan(0);
      expect(refreshMaxAge).toBeGreaterThan(0);
      expect(clearTokenCookieOptions()).toEqual(accessRest);
      expect(clearTokenCookieOptions()).toEqual(refreshRest);
      expect(clearTokenCookieOptions()).not.toHaveProperty('maxAge');
    },
  );

  it('httpOnly + sameSite lax + path /; secure chỉ khi NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(accessTokenCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
    });

    process.env.NODE_ENV = 'development';
    expect(accessTokenCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
    });
  });
});

@Controller('cookie-test')
class CookieTestController {
  @Get('set')
  set(@Res({ passthrough: true }) res: Response) {
    res.cookie(ACCESS_TOKEN_COOKIE, 'a', accessTokenCookieOptions());
    res.cookie(REFRESH_TOKEN_COOKIE, 'r', refreshTokenCookieOptions());
    return {};
  }

  // Cùng cách AuthController.logout gọi.
  @Get('clear')
  clear(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, clearTokenCookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE, clearTokenCookieOptions());
    return {};
  }
}

// Kiểm header `Set-Cookie` THẬT mà Express 5 sinh ra: đặt rồi xoá phải trùng Domain/Path/Secure/SameSite,
// nếu không trình duyệt giữ lại cookie cũ khi đăng xuất.
function parseSetCookie(header: string): {
  name: string;
  attrs: Record<string, string | true>;
} {
  const [first, ...rest] = header.split('; ');
  const attrs: Record<string, string | true> = {};
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq === -1) attrs[part.toLowerCase()] = true;
    else attrs[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
  }
  return { name: first.slice(0, first.indexOf('=')), attrs };
}

describe('Set-Cookie thật: đặt rồi xoá phải khớp thuộc tính', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CookieTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function cookiesFrom(path: string) {
    const res = await request(app.getHttpServer()).get(path).expect(200);
    const headers = res.headers['set-cookie'] as unknown as string[];
    return headers.map(parseSetCookie);
  }

  it.each([undefined, '.chot.store'])(
    'COOKIE_DOMAIN=%j (production): Domain/Path/Secure/SameSite/HttpOnly của lúc xoá = lúc đặt',
    async (value) => {
      process.env.NODE_ENV = 'production';
      if (value !== undefined) process.env.COOKIE_DOMAIN = value;

      const set = await cookiesFrom('/cookie-test/set');
      const cleared = await cookiesFrom('/cookie-test/clear');

      expect(set.map((c) => c.name)).toEqual([
        ACCESS_TOKEN_COOKIE,
        REFRESH_TOKEN_COOKIE,
      ]);
      expect(cleared.map((c) => c.name)).toEqual([
        ACCESS_TOKEN_COOKIE,
        REFRESH_TOKEN_COOKIE,
      ]);

      for (const [i, setCookie] of set.entries()) {
        const clearCookie = cleared[i];
        for (const key of [
          'domain',
          'path',
          'secure',
          'samesite',
          'httponly',
        ]) {
          expect(clearCookie.attrs[key]).toEqual(setCookie.attrs[key]);
        }
        expect(setCookie.attrs['domain']).toBe(value);
        expect(setCookie.attrs['secure']).toBe(true);
        expect(setCookie.attrs['max-age']).toBeDefined();
        // Xoá = hết hạn quá khứ, không còn max-age.
        expect(clearCookie.attrs['max-age']).toBeUndefined();
        expect(
          new Date(clearCookie.attrs['expires'] as string).getTime(),
        ).toBeLessThan(Date.now());
      }
    },
  );
});
