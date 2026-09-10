import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import type { AuthenticatedUser, JwtPayload } from '../types/jwt-payload.type';

function cookieExtractor(req: Request): string | null {
  const token = req?.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
  return token ?? null;
}

// Xác thực access token gửi qua httpOnly cookie (đọc được nhờ `cookie-parser`
// đăng ký ở main.ts). Đăng ký trong AuthModule với tên mặc định 'jwt', dùng
// qua JwtAuthGuard.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, role: payload.role };
  }
}
