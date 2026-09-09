import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types/jwt-payload.type';

// Xác thực refresh token (chỉ dùng cho endpoint POST /auth/refresh) — gửi
// qua header "Authorization: Bearer <refreshToken>", tên strategy 'jwt-refresh'
// để tách hẳn khỏi JwtStrategy (access token), không dùng nhầm secret.
@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET as string,
      passReqToCallback: true,
    });
  }

  // Trả kèm refreshToken thô — AuthService.refreshTokens() cần nó để đối
  // chiếu với refreshTokenHash lưu trong DB (Bước 2.4), không chỉ tin chữ ký JWT.
  validate(req: Request, payload: JwtPayload) {
    const refreshToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    return { userId: payload.sub, role: payload.role, refreshToken };
  }
}
