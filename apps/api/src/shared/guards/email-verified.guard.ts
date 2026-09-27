import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload.type';

// Luôn dùng SAU JwtAuthGuard (vd @UseGuards(JwtAuthGuard, EmailVerifiedGuard))
// — cần req.user đã set sẵn. Chặn feature-level (checkout, tạo shop...) khi
// email chưa xác thực — KHÔNG dùng để chặn login/browse/cart/wishlist, và
// KHÔNG dùng thay cho accountStatus (session-level, xem
// auth-shop-status-architecture.md).
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!user) {
      return false;
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { emailVerifiedAt: true },
    });
    if (!dbUser?.emailVerifiedAt) {
      throw new AppException(403, 'EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED');
    }

    return true;
  }
}
