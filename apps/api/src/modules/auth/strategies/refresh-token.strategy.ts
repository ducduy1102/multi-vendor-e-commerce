import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { REFRESH_TOKEN_COOKIE } from '../auth.constants';
import type { JwtPayload } from '../types/jwt-payload.type';

function cookieExtractor(req: Request): string | null {
  const token = req?.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
  return token ?? null;
}

// Xác thực refresh token (chỉ dùng cho endpoint POST /auth/refresh) — gửi
// qua httpOnly cookie, tên strategy 'jwt-refresh' để tách hẳn khỏi
// JwtStrategy (access token), không dùng nhầm secret.
@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET as string,
      passReqToCallback: true,
    });
  }

  // Trả kèm refreshToken thô — AuthService.refreshTokens() cần nó để đối
  // chiếu với refreshTokenHash lưu trong DB (Bước 2.4), không chỉ tin chữ ký JWT.
  validate(req: Request, payload: JwtPayload) {
    const refreshToken = cookieExtractor(req);
    return { userId: payload.sub, role: payload.role, refreshToken };
  }
}
