import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus } from '@prisma/client';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { AppException } from '../../../shared/exceptions/app.exception';
import { PrismaService } from '../../../shared/prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  // Query lại DB (không chỉ decode payload) để tài khoản bị khoá sau khi JWT
  // đã cấp mất hiệu lực ngay, không phải chờ access token hết hạn (~15p) —
  // đánh đổi có chủ đích, xem auth-shop-status-architecture.md mục 4.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { accountStatus: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new AppException(401, 'ACCOUNT_NOT_ACTIVE', 'ACCOUNT_NOT_ACTIVE');
    }

    return { userId: payload.sub, role: payload.role };
  }
}
