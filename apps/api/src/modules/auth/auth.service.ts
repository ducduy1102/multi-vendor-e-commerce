import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import {
  AccountStatus,
  OAuthProvider,
  Prisma,
  Role,
  User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { frontendUrl } from '../../shared/mail/frontend-url';
import {
  DEFAULT_MAIL_LOCALE,
  type MailLocale,
} from '../../shared/mail/mail-locale';
import { MailService } from '../../shared/mail/mail.service';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  PASSWORD_RESET_RESEND_COOLDOWN_MS,
  readPasswordResetTtlMinutes,
} from './auth.constants';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { GoogleProfile } from './types/google-profile.type';

const SALT_ROUNDS = 10;

// MỘT chuỗi duy nhất cho mọi kết quả của forgot-password (xem AuthService.forgotPassword).
export const FORGOT_PASSWORD_MESSAGE =
  'Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu';

interface VerificationToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

// Hình dạng user trả ra ngoài (khớp `authUserSchema`). Là ALLOWLIST: cột nào thêm vào bảng users sau này
// (hash, token, cột nội bộ) mặc định KHÔNG lọt ra response — thêm field vào đây là quyết định có chủ đích.
export type SafeUser = Pick<
  User,
  'id' | 'email' | 'name' | 'role' | 'emailVerifiedAt' | 'locale'
> & { hasPassword: boolean };

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
        // FE luôn gửi; client khác bỏ trống ⇒ ngôn ngữ mặc định (cùng giá trị DEFAULT của cột).
        locale: dto.locale ?? DEFAULT_MAIL_LOCALE,
        emailVerificationTokenHash: verification.tokenHash,
        emailVerificationExpiresAt: verification.expiresAt,
        emailVerificationSentAt: new Date(),
      },
    });
    await this.sendVerificationEmailSafely(
      user.email,
      user.name,
      verification.rawToken,
      user.locale,
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
    // Token không tồn tại (sai / đã dùng — hash bị xoá sau khi xác thực) và token hết hạn cùng MỘT mã, để
    // không lộ token từng tồn tại hay không; FE chỉ cần biết "link này không dùng được, xin link mới".
    if (
      !user?.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new AppException(
        400,
        'VERIFY_TOKEN_INVALID',
        'The email verification link is invalid or has expired',
      );
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
      throw new AppException(
        400,
        'EMAIL_ALREADY_VERIFIED',
        'The email address is already verified',
      );
    }
    if (
      user.emailVerificationSentAt &&
      Date.now() - user.emailVerificationSentAt.getTime() <
        EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        'VERIFICATION_RESEND_TOO_SOON',
        'Please wait before requesting another verification email',
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
      user.locale,
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
    locale: MailLocale,
  ): Promise<void> {
    try {
      await this.mailService.sendVerificationEmail(
        email,
        name,
        this.buildVerifyEmailUrl(rawToken, locale),
        locale,
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
    // user.passwordHash null nghĩa là tài khoản chỉ đăng ký qua OAuth (xem
    // loginWithGoogle) — không lộ chi tiết đó ra ngoài, trả cùng 1 message
    // chung với sai mật khẩu để tránh lộ phương thức đăng nhập của 1 email.
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    // Check sau khi xác minh mật khẩu — không lộ việc tài khoản bị khoá cho
    // request sai mật khẩu (giữ nguyên message chung ở nhánh trên).
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new AppException(401, 'ACCOUNT_NOT_ACTIVE', 'ACCOUNT_NOT_ACTIVE');
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  // Gọi từ AuthController.googleCallback() sau khi GoogleStrategy xác thực
  // xong với Google — profile.email do Google trả về, coi như đã verify sẵn
  // (Google chỉ cho OAuth với email đã xác thực), không cần luồng verify
  // token riêng như đăng ký bằng password (Bước 2.10).
  async loginWithGoogle(profile: GoogleProfile) {
    const existingAccount = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: OAuthProvider.GOOGLE,
          providerUserId: profile.googleId,
        },
      },
      include: { user: true },
    });

    let user: User;
    if (existingAccount) {
      user = existingAccount.user;
    } else {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
      if (existingUser) {
        // Email đã có tài khoản (đăng ký bằng password trước đó) — liên kết
        // thêm Google vào đúng user này thay vì tạo user trùng email (email
        // là @unique trong DB nên tạo mới chắc chắn lỗi).
        await this.prisma.oAuthAccount.create({
          data: {
            userId: existingUser.id,
            provider: OAuthProvider.GOOGLE,
            providerUserId: profile.googleId,
          },
        });
        user = existingUser.emailVerifiedAt
          ? existingUser
          : await this.prisma.user.update({
              where: { id: existingUser.id },
              data: { emailVerifiedAt: new Date() },
            });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            passwordHash: null,
            emailVerifiedAt: new Date(),
            oauthAccounts: {
              create: {
                provider: OAuthProvider.GOOGLE,
                providerUserId: profile.googleId,
              },
            },
          },
        });
      }
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new AppException(401, 'ACCOUNT_NOT_ACTIVE', 'ACCOUNT_NOT_ACTIVE');
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

  // PATCH /auth/me (Week9.md 1.11). Chỉ tên và ngôn ngữ email, lấy từ dữ liệu ĐÃ parse bởi
  // updateProfileSchema (field lạ như email/role/accountStatus đã bị bỏ) — nên không có đường nào để mass-
  // assignment tới được cột khác. Email không sửa được ở đây (đổi email cần xác thực lại, chuyển giao).
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.locale !== undefined) data.locale = dto.locale;

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
      });
      return { user: this.sanitizeUser(user) };
    } catch (error) {
      // User bị xoá giữa lúc guard xác thực và lúc ghi ⇒ hết phiên, không phải lỗi hệ thống.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new UnauthorizedException();
      }
      throw error;
    }
  }

  // POST /auth/change-password (Week9.md 1.11) — người ĐÃ đăng nhập biết mật khẩu hiện tại.
  // - Tài khoản chỉ đăng nhập Google (passwordHash null) chưa có gì để "đổi": PASSWORD_NOT_SET, FE dẫn sang
  //   luồng quên mật khẩu để đặt lần đầu.
  // - UPDATE có điều kiện theo đúng hash vừa xác minh: nếu giữa chừng mật khẩu bị đổi bởi luồng khác (vd chủ
  //   tài khoản vừa đặt lại mật khẩu để đá kẻ giữ phiên cũ), request này KHÔNG được ghi đè lại — kẻ đó đã
  //   xác minh bằng mật khẩu CŨ.
  // - Xoá luôn token đặt lại đang chờ (link cũ không được dùng để đổi lại mật khẩu vừa đặt).
  // - Cấp lại cặp token cho phiên hiện tại; mọi refresh token cũ (thiết bị khác) chết vì refreshTokenHash
  //   bị ghi đè. Access token cũ ở thiết bị khác còn sống tối đa ~15 phút (giới hạn đã biết của JWT ngắn hạn).
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (!user.passwordHash) {
      throw new AppException(
        400,
        'PASSWORD_NOT_SET',
        'This account has no password yet; use the forgot-password flow to set one',
      );
    }
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new AppException(
        400,
        'CURRENT_PASSWORD_INCORRECT',
        'The current password is incorrect',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetSentAt: null,
      },
    });
    if (count === 0) {
      throw new AppException(
        400,
        'CURRENT_PASSWORD_INCORRECT',
        'The current password is incorrect',
      );
    }

    const tokens = await this.issueTokens(user.id, user.role);
    await this.sendPasswordChangedEmailSafely(user);
    return { message: 'Đã đổi mật khẩu', ...tokens };
  }

  // POST /auth/forgot-password (Week9.md 1.11) — CÔNG KHAI nên phản hồi PHẢI giống hệt nhau dù email có tài
  // khoản hay không, tài khoản có bị khoá hay không, hay đang trong cooldown: khác nhau ở bất cứ chỗ nào (body,
  // status, thời gian trả lời) đều thành công cụ dò xem email nào có tài khoản.
  // - Cooldown được "giành" bằng một UPDATE có điều kiện (không đọc-rồi-ghi): hai request đồng thời chỉ một
  //   cái thắng và gửi mail.
  // - Mail gửi KHÔNG chờ (fire-and-forget): chờ Resend ~hàng trăm ms chỉ ở nhánh email tồn tại sẽ lộ ra qua
  //   thời gian phản hồi. Lỗi gửi được log trong sendPasswordResetEmailSafely, không bao giờ ném.
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user && user.accountStatus === AccountStatus.ACTIVE) {
      const now = new Date();
      const cooldownCutoff = new Date(
        now.getTime() - PASSWORD_RESET_RESEND_COOLDOWN_MS,
      );
      const ttlMinutes = readPasswordResetTtlMinutes();
      const token = this.generateToken(ttlMinutes * 60 * 1000);

      const { count } = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [
            { passwordResetSentAt: null },
            { passwordResetSentAt: { lt: cooldownCutoff } },
          ],
        },
        data: {
          passwordResetTokenHash: token.tokenHash,
          passwordResetExpiresAt: token.expiresAt,
          passwordResetSentAt: now,
        },
      });
      if (count === 1) {
        void this.sendPasswordResetEmailSafely(
          user,
          token.rawToken,
          ttlMinutes,
        );
      }
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  // POST /auth/reset-password (Week9.md 1.11) — CÔNG KHAI, xác thực bằng token trong email.
  // - Token sai / hết hạn / đã dùng / tài khoản không ACTIVE đều ra MỘT mã RESET_TOKEN_INVALID (không lộ
  //   token từng tồn tại hay không).
  // - Dùng MỘT lần: UPDATE có điều kiện theo token + hạn + ACTIVE rồi xoá token trong cùng câu lệnh — hai
  //   request đồng thời với cùng token chỉ một cái có count = 1.
  // - Thu hồi phiên: refreshTokenHash = null (refresh token cũ chết; access token cũ sống tối đa ~15 phút).
  // - Tài khoản Google-only đi đúng luồng này để đặt mật khẩu LẦN ĐẦU (passwordHash từ null thành giá trị).
  // - So khớp token qua WHERE trên hash (không so chuỗi trong mã) nên không cần timingSafeEqual — cùng cách
  //   verifyEmail; hash của token 256 bit không thể bị "đoán dần từng byte" qua thời gian truy vấn.
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);
    const user = await this.prisma.user.findUnique({
      where: { passwordResetTokenHash: tokenHash },
    });
    if (
      !user?.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() <= Date.now() ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw this.resetTokenInvalid();
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: new Date() },
        accountStatus: AccountStatus.ACTIVE,
      },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetSentAt: null,
        refreshTokenHash: null,
      },
    });
    if (count === 0) {
      throw this.resetTokenInvalid();
    }

    await this.sendPasswordChangedEmailSafely(user);
    return { message: 'Đã đặt lại mật khẩu' };
  }

  private resetTokenInvalid(): AppException {
    return new AppException(
      400,
      'RESET_TOKEN_INVALID',
      'The password reset link is invalid or has expired',
    );
  }

  // Cùng nguyên tắc sendVerificationEmailSafely: DB đã ghi xong, mail lỗi chỉ được log (người dùng bấm lại
  // "quên mật khẩu" sau 60 giây). KHÔNG log token.
  private async sendPasswordResetEmailSafely(
    user: User,
    rawToken: string,
    expiresInMinutes: number,
  ): Promise<void> {
    try {
      await this.mailService.sendPasswordReset(user.email, {
        locale: user.locale,
        name: user.name,
        resetUrl: frontendUrl(
          `/reset-password?token=${encodeURIComponent(rawToken)}`,
          user.locale,
        ),
        expiresInMinutes,
      });
    } catch (error) {
      this.logger.error(
        `Gửi email đặt lại mật khẩu thất bại cho ${user.email}: ${(error as Error).message}`,
      );
    }
  }

  // Email bảo mật cho CHÍNH CHỦ sau mỗi lần đổi/đặt lại mật khẩu thành công. Gửi SAU khi DB đã ghi.
  private async sendPasswordChangedEmailSafely(user: User): Promise<void> {
    try {
      await this.mailService.sendPasswordChanged(user.email, {
        locale: user.locale,
        name: user.name,
        forgotPasswordUrl: frontendUrl('/forgot-password', user.locale),
      });
    } catch (error) {
      this.logger.error(
        `Gửi email đã đổi mật khẩu thất bại cho ${user.email}: ${(error as Error).message}`,
      );
    }
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
    // jwtid NGẪU NHIÊN: JWT chỉ có iat tính bằng GIÂY, nên hai refresh token cấp trong cùng một giây cho
    // cùng một user sẽ GIỐNG HỆT từng byte — thu hồi rồi đăng nhập lại ngay (đổi/đặt lại mật khẩu, xoay vòng
    // token) sẽ vô tình làm sống lại token cũ vì hash khớp. Mỗi token phải là duy nhất.
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      jwtid: randomUUID(),
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

  private sanitizeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      locale: user.locale,
      // Tính từ hash TRƯỚC khi nó biến mất khỏi response — FE chọn "đổi" hay "đặt" mật khẩu theo cờ này.
      hasPassword: user.passwordHash !== null,
    };
  }

  private generateVerificationToken(): VerificationToken {
    return this.generateToken(EMAIL_VERIFICATION_TOKEN_TTL_MS);
  }

  // Token dùng một lần gửi qua email (xác thực email, đặt lại mật khẩu): 32 byte ngẫu nhiên (256 bit
  // entropy), chỉ lưu SHA-256 của nó.
  private generateToken(ttlMs: number): VerificationToken {
    const rawToken = randomBytes(32).toString('hex');
    return {
      rawToken,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  // Link có prefix ngôn ngữ của người nhận (`/en/...` cho en): FE dùng `localePrefix: as-needed`.
  private buildVerifyEmailUrl(rawToken: string, locale: MailLocale): string {
    return frontendUrl(
      `/verify-email?token=${encodeURIComponent(rawToken)}`,
      locale,
    );
  }
}
