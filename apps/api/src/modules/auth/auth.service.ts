import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { MailService } from '../../shared/mail/mail.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 10;

interface VerificationToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const verification = this.generateVerificationToken();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        emailVerificationTokenHash: verification.tokenHash,
        emailVerificationExpiresAt: verification.expiresAt,
        emailVerificationSentAt: new Date(),
      },
    });
    await this.sendVerificationEmailSafely(
      user.email,
      user.name,
      verification.rawToken,
    );

    // Không tự issue token/tạo session sau khi đăng ký — bắt người dùng đăng
    // nhập lại (FE điều hướng sang /login), không auto-login thẳng vào app.
    return { user: this.sanitizeUser(user) };
  }

  // Token verify là random string do server tự sinh (entropy cao), không
  // phải password người dùng chọn — hash bằng SHA-256 (như refresh token),
  // lookup trực tiếp qua hash trong WHERE nên không cần timingSafeEqual ở đây.
  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findUnique({
      where: { emailVerificationTokenHash: tokenHash },
    });
    if (!user?.emailVerificationExpiresAt) {
      throw new BadRequestException('Token xác thực không hợp lệ');
    }
    if (user.emailVerificationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Token xác thực đã hết hạn');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    return { message: 'Xác thực email thành công' };
  }

  // Yêu cầu đã đăng nhập (userId lấy từ JwtAuthGuard) — tránh phải nhận email
  // qua body (rò rỉ việc email nào tồn tại trong hệ thống - email enumeration).
  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email đã được xác thực');
    }
    if (
      user.emailVerificationSentAt &&
      Date.now() - user.emailVerificationSentAt.getTime() <
        EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw new HttpException(
        'Vui lòng đợi trước khi gửi lại email xác thực',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const verification = this.generateVerificationToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: verification.tokenHash,
        emailVerificationExpiresAt: verification.expiresAt,
        emailVerificationSentAt: new Date(),
      },
    });
    await this.sendVerificationEmailSafely(
      user.email,
      user.name,
      verification.rawToken,
    );

    return { message: 'Đã gửi lại email xác thực' };
  }

  // User đã được tạo/cập nhật token trong DB thành công trước khi gọi hàm
  // này — nếu provider mail lỗi (Resend down, sai API key, hết quota...)
  // không được để cả request thất bại (register()/resendVerification() đã
  // "xong" việc của nó), chỉ log lại để debug. Người dùng vẫn có thể bấm
  // "gửi lại" sau.
  private async sendVerificationEmailSafely(
    email: string,
    name: string,
    rawToken: string,
  ): Promise<void> {
    try {
      await this.mailService.sendVerificationEmail(
        email,
        name,
        this.buildVerifyEmailUrl(rawToken),
      );
    } catch (error) {
      this.logger.error(
        `Gửi email xác thực thất bại cho ${email}: ${(error as Error).message}`,
      );
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    // Check sau khi xác minh mật khẩu — không lộ việc tài khoản bị khoá cho
    // request sai mật khẩu (giữ nguyên message chung ở nhánh trên).
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('ACCOUNT_NOT_ACTIVE');
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

  // JWT payload (Bước 2.5) chỉ có sub/role, không có email/name — phải query
  // lại DB. Coi user không còn tồn tại (đã bị xoá sau khi token issue) là
  // hết phiên, không phải lỗi hệ thống.
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    return { user: this.sanitizeUser(user) };
  }

  private async issueTokens(userId: string, role: Role): Promise<TokenPair> {
    const payload = { sub: userId, role };

    // expiresIn của @nestjs/jwt yêu cầu kiểu StringValue (vd "15m") chứ không
    // phải string thường — env var luôn là string nên cần ép kiểu tường minh.
    // "|| " (không phải "??") để fallback cả khi ENV khai rỗng (vd ".env" có
    // dòng không giá trị) — "??" chỉ fallback khi undefined/null, không bắt
    // được chuỗi rỗng (xem bug thật ở ResendMailProvider.from).
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN?.trim() ||
        '15m') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN?.trim() ||
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

  private sanitizeUser(
    user: User,
  ): Omit<
    User,
    'passwordHash' | 'refreshTokenHash' | 'emailVerificationTokenHash'
  > {
    const safe: Partial<User> = { ...user };
    delete safe.passwordHash;
    delete safe.refreshTokenHash;
    delete safe.emailVerificationTokenHash;
    return safe as Omit<
      User,
      'passwordHash' | 'refreshTokenHash' | 'emailVerificationTokenHash'
    >;
  }

  private generateVerificationToken(): VerificationToken {
    const rawToken = randomBytes(32).toString('hex');
    return {
      rawToken,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    };
  }

  private buildVerifyEmailUrl(rawToken: string): string {
    const base = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
    return `${base}/verify-email?token=${rawToken}`;
  }
}
