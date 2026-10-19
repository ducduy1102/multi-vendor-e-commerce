import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

// Cổng xác thực của hạ tầng real-time (Week10.md 3.2, "Nguyên tắc để tách microservice sau"): gateway chỉ biết
// giao diện này, không biết JWT hay Prisma. Khi tách cổng real-time thành service riêng, chỉ thay bản cài đặt
// (vd gọi HTTP sang API, hoặc verify bằng khoá công khai) mà không sửa gateway.
export interface VerifiedSocketToken {
  userId: string;
  role: Role;
  // Thời điểm access token hết hạn, giây kể từ epoch (claim `exp` của JWT).
  exp: number;
}

export interface SocketAuthenticator {
  // null nếu token sai chữ ký/sai thuật toán/hết hạn/payload lạ. NÉM LỖI chỉ khi hạ tầng hỏng (vd thiếu
  // JWT_ACCESS_SECRET) — nơi gọi phải coi đó là "không xác thực được" (đóng), không phải "token sai".
  verifyToken(token: string): Promise<VerifiedSocketToken | null>;
  isUserActive(userId: string): Promise<boolean>;
}

// Token DI của cổng xác thực.
export const SOCKET_AUTHENTICATOR = Symbol('SOCKET_AUTHENTICATOR');

// Payload do chính server ký (JwtPayload ở modules/auth) nhưng vẫn kiểm hình dạng: verify chữ ký đúng chưa đủ
// để tin các trường có đủ và đúng kiểu (rules/general.md mục 4 — validate mọi input bằng Zod).
const tokenPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.nativeEnum(Role),
  exp: z.number().int().positive(),
});

// Bản chạy trong cùng tiến trình với API: verify access token bằng JWT_ACCESS_SECRET (cùng secret với
// JwtStrategy) và đọc lại `accountStatus` từ DB — cùng nguyên tắc với JwtStrategy.validate: tài khoản bị khoá
// mất hiệu lực ngay, không đợi access token hết hạn.
@Injectable()
export class JwtSocketAuthenticator implements SocketAuthenticator {
  // Constructor rẻ và không throw (rules/backend.md mục 8); secret đọc LÚC DÙNG.
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async verifyToken(token: string): Promise<VerifiedSocketToken | null> {
    const secret = process.env.JWT_ACCESS_SECRET?.trim();
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        token,
        // Ghim HS256 (thuật toán duy nhất mà AuthService ký): chặn nhầm thuật toán / "alg: none" dù thư viện
        // đã có mặc định, để quy tắc không phụ thuộc mặc định của phiên bản.
        { secret, algorithms: ['HS256'] },
      );
    } catch {
      return null;
    }

    const parsed = tokenPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      userId: parsed.data.sub,
      role: parsed.data.role,
      exp: parsed.data.exp,
    };
  }

  async isUserActive(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });
    return user?.accountStatus === AccountStatus.ACTIVE;
  }
}
