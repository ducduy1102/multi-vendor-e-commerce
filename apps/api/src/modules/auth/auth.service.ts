import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 10;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  // userId + refreshToken đã được RefreshTokenStrategy xác minh chữ ký JWT
  // (Bước 2.5) — ở đây chỉ đối chiếu lại với hash lưu trong DB, cho phép
  // thu hồi token qua logout() mà không cần blacklist riêng.
  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException();
    }

    if (!this.tokensMatch(refreshToken, user.refreshTokenHash)) {
      throw new UnauthorizedException();
    }

    return this.issueTokens(user.id, user.role);
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  private async issueTokens(userId: string, role: Role): Promise<TokenPair> {
    const payload = { sub: userId, role };

    // expiresIn của @nestjs/jwt yêu cầu kiểu StringValue (vd "15m") chứ không
    // phải string thường — env var luôn là string nên cần ép kiểu tường minh.
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ??
        '15m') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
        '7d') as JwtSignOptions['expiresIn'],
    });

    const refreshTokenHash = this.hashToken(refreshToken);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

    return { accessToken, refreshToken };
  }

  // Refresh token là secret entropy cao do server tự sinh (khác password
  // người dùng chọn) — dùng SHA-256 thay vì bcrypt để hash/so khớp.
  // bcrypt chỉ đọc 72 byte đầu input: JWT của cùng 1 user luôn trùng phần
  // đầu (header + sub + role), phần khác nhau thật sự (iat/exp/chữ ký) nằm
  // sau byte 72 — bcrypt.compare sẽ báo khớp nhầm giữa các token khác nhau,
  // khiến refresh token cũ (đã rotate) vẫn dùng lại được (đã phát hiện qua
  // test tay POST /auth/refresh 2 lần liên tiếp).
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private tokensMatch(rawToken: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashToken(rawToken));
    const stored = Buffer.from(storedHash);
    return (
      candidate.length === stored.length && timingSafeEqual(candidate, stored)
    );
  }

  private sanitizeUser(user: User) {
    const {
      passwordHash: _passwordHash,
      refreshTokenHash: _refreshTokenHash,
      ...safe
    } = user;
    return safe;
  }
}
