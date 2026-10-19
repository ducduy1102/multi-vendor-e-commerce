import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { decodeOAuthState } from '../../shared/utils/oauth-state';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { AppException } from '../../shared/exceptions/app.exception';
import { GoogleAuthGuard } from '../../shared/guards/google-auth.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RefreshTokenGuard } from '../../shared/guards/refresh-token.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  clearTokenCookieOptions,
  googleFailureRedirectUrl,
  googleSuccessRedirectUrl,
  refreshTokenCookieOptions,
} from './auth.constants';
import { AuthService, type TokenPair } from './auth.service';
import { ClearSessionCookiesFilter } from './clear-session-cookies.filter';
import {
  changePasswordSchema,
  type ChangePasswordDto,
} from './dto/change-password.dto';
import {
  forgotPasswordSchema,
  type ForgotPasswordDto,
} from './dto/forgot-password.dto';
import { loginSchema, type LoginDto } from './dto/login.dto';
import { registerSchema, type RegisterDto } from './dto/register.dto';
import {
  resetPasswordSchema,
  type ResetPasswordDto,
} from './dto/reset-password.dto';
import {
  updateProfileSchema,
  type UpdateProfileDto,
} from './dto/update-profile.dto';
import { verifyEmailSchema, type VerifyEmailDto } from './dto/verify-email.dto';
import type { GoogleProfile } from './types/google-profile.type';
import type { AuthenticatedUser } from './types/jwt-payload.type';

// DTO validate bằng Zod (không phải class), @nestjs/swagger không tự suy ra
// schema từ class được nên khai @ApiBody bằng example thủ công thay vì
// @ApiBody({ type: RegisterDto }).
const USER_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER',
  emailVerifiedAt: null,
  locale: 'vi',
  hasPassword: true,
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 201: tạo mới User — không issue token/set cookie (không auto-login),
  // FE điều hướng người dùng sang /login sau khi đăng ký xong.
  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản mới — không tự đăng nhập' })
  @ApiBody({
    schema: {
      example: {
        email: 'user@example.com',
        password: 'password123',
        name: 'Nguyen Van A',
        locale: 'vi',
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo user thành công',
    schema: { example: { success: true, data: { user: USER_EXAMPLE } } },
  })
  @ApiResponse({
    status: 400,
    description:
      'Email đã được sử dụng, hoặc dữ liệu không hợp lệ (tên rỗng/quá 100 ký tự/có ký tự < > hoặc ký tự điều khiển, mật khẩu < 8 ký tự hoặc > 72 byte, locale ngoài vi/en)',
  })
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Mặc định NestJS trả 201 cho POST — login/refresh/logout là action,
  // không tạo resource mới, nên ép về 200 (đúng checklist RESTful mục 2).
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng nhập — set access_token/refresh_token qua httpOnly cookie',
  })
  @ApiBody({
    schema: {
      example: { email: 'user@example.com', password: 'password123' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập thành công',
    schema: { example: { success: true, data: { user: USER_EXAMPLE } } },
  })
  @ApiResponse({
    status: 401,
    description:
      'Email hoặc mật khẩu không đúng (không có code), hoặc tài khoản không ở trạng thái ACTIVE (code: ACCOUNT_NOT_ACTIVE)',
    examples: {
      invalidCredentials: {
        summary: 'Sai email/mật khẩu',
        value: {
          success: false,
          data: null,
          message: 'Email hoặc mật khẩu không đúng',
        },
      },
      accountNotActive: {
        summary: 'ACCOUNT_NOT_ACTIVE',
        value: {
          success: false,
          data: null,
          message: 'ACCOUNT_NOT_ACTIVE',
          code: 'ACCOUNT_NOT_ACTIVE',
        },
      },
    },
  })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, ...rest } =
      await this.authService.login(dto);
    this.setTokenCookies(res, { accessToken, refreshToken });
    return rest;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshTokenGuard)
  // Bị từ chối mà request có gửi cookie refresh_token ⇒ 401 kèm lệnh xoá cả 2 cookie phiên (xem filter).
  @UseFilters(ClearSessionCookiesFilter)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Làm mới access/refresh token, rotate cả 2 cookie' })
  @ApiResponse({
    status: 200,
    description: 'Token đã được làm mới',
    schema: {
      example: { success: true, data: { message: 'Token đã được làm mới' } },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      'refresh_token không hợp lệ, hết hạn, đã xoay hoặc đã thu hồi. Nếu request có gửi cookie refresh_token thì response kèm Set-Cookie xoá cả access_token lẫn refresh_token; không có cookie thì không đụng tới cookie nào',
  })
  async refresh(
    @CurrentUser() user: AuthenticatedUser & { refreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refreshTokens(
      user.userId,
      user.refreshToken,
    );
    this.setTokenCookies(res, tokens);
    return { message: 'Token đã được làm mới' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Đăng xuất — clear cả 2 cookie' })
  @ApiResponse({
    status: 200,
    description: 'Đăng xuất thành công',
    schema: {
      example: { success: true, data: { message: 'Đăng xuất thành công' } },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.userId);
    res.clearCookie(ACCESS_TOKEN_COOKIE, clearTokenCookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE, clearTokenCookieOptions());
    return { message: 'Đăng xuất thành công' };
  }

  // Browser điều hướng thẳng tới URL này (thẻ <a>, không phải fetch) —
  // GoogleAuthGuard (passport-google-oauth20) tự redirect sang trang đồng ý
  // của Google, không cần code gì thêm ở đây.
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: 'Redirect sang Google để đăng nhập/đăng ký bằng tài khoản Google',
  })
  @ApiQuery({
    name: 'next',
    required: false,
    description:
      'Đường dẫn nội bộ (không kèm locale, thuộc allow-list như /checkout) để quay lại sau khi đăng nhập; giá trị không hợp lệ bị bỏ qua',
    example: '/checkout',
  })
  @ApiQuery({
    name: 'locale',
    required: false,
    enum: ['vi', 'en'],
    description:
      'Ngôn ngữ của trang người dùng bấm nút: sau khi đăng nhập (hoặc lỗi) BE redirect về FE với đúng prefix ngôn ngữ (en → /en/...); giá trị lạ bị bỏ qua, mặc định vi (không prefix)',
    example: 'en',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect sang trang đăng nhập Google',
  })
  googleAuth(): void {}

  // Google redirect trình duyệt về đây sau khi user đồng ý — không phải API
  // JSON thông thường nên KHÔNG dùng TransformResponseInterceptor (đăng ký
  // route bằng @Res() không passthrough), set cookie xong redirect thẳng về
  // FE, lỗi cũng redirect kèm query param thay vì trả JSON (không ai đọc
  // được JSON giữa 1 lần điều hướng trình duyệt).
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary:
      'Google redirect lại sau khi đồng ý — set cookie rồi redirect về FE',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect về FE, đã set cookie access_token/refresh_token',
  })
  async googleCallback(
    @Req() req: Request & { user: GoogleProfile },
    @Res() res: Response,
  ): Promise<void> {
    // `state` (đích `next` + ngôn ngữ của trang bấm nút) đã đi vòng qua trình duyệt và Google nên KHÔNG tin
    // — decodeOAuthState kiểm lại từng giá trị; không có/không hợp lệ thì giữ hành vi cũ (trang chủ, vi).
    const { next, locale } = decodeOAuthState(req.query.state);
    try {
      const { accessToken, refreshToken } =
        await this.authService.loginWithGoogle(req.user);
      this.setTokenCookies(res, { accessToken, refreshToken });
      res.redirect(googleSuccessRedirectUrl(next, locale));
    } catch (error) {
      const reason =
        error instanceof AppException && error.code === 'ACCOUNT_NOT_ACTIVE'
          ? 'account_not_active'
          : 'google_login_failed';
      res.redirect(googleFailureRedirectUrl(reason, next, locale));
    }
  }

  // FE dùng httpOnly cookie nên JS không đọc được token để biết ai đang đăng
  // nhập — endpoint này cho phép hydrate lại state (vd sau khi F5 trang).
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Lấy thông tin user hiện tại từ session' })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { user: USER_EXAMPLE } } },
  })
  @ApiResponse({
    status: 401,
    description:
      'Chưa đăng nhập/session hết hạn (không có code), hoặc tài khoản không còn ACTIVE (code: ACCOUNT_NOT_ACTIVE)',
    examples: {
      unauthorized: {
        summary: 'Chưa đăng nhập / session hết hạn',
        value: { success: false, data: null, message: 'Unauthorized' },
      },
      accountNotActive: {
        summary: 'ACCOUNT_NOT_ACTIVE',
        value: {
          success: false,
          data: null,
          message: 'ACCOUNT_NOT_ACTIVE',
          code: 'ACCOUNT_NOT_ACTIVE',
        },
      },
    },
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực email qua token gửi trong mail' })
  @ApiBody({ schema: { example: { token: 'a1b2c3...' } } })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { message: 'Xác thực email thành công' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Dữ liệu không hợp lệ (không có code), hoặc VERIFY_TOKEN_INVALID: token sai / hết hạn / đã dùng',
    examples: {
      validation: {
        summary: 'Dữ liệu không hợp lệ (không có code)',
        value: {
          success: false,
          data: null,
          message: 'token: auth.validationTokenInvalid',
        },
      },
      verifyTokenInvalid: {
        summary: 'VERIFY_TOKEN_INVALID',
        value: {
          success: false,
          data: null,
          message: 'The email verification link is invalid or has expired',
          code: 'VERIFY_TOKEN_INVALID',
        },
      },
    },
  })
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) dto: VerifyEmailDto,
  ) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Gửi lại email xác thực — cần đăng nhập' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { message: 'Đã gửi lại email xác thực' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'EMAIL_ALREADY_VERIFIED: email đã được xác thực',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'The email address is already verified',
        code: 'EMAIL_ALREADY_VERIFIED',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 429,
    description:
      'VERIFICATION_RESEND_TOO_SOON: gửi quá nhanh, còn trong thời gian chờ giữa hai lần gửi',
    schema: {
      example: {
        success: false,
        data: null,
        message: 'Please wait before requesting another verification email',
        code: 'VERIFICATION_RESEND_TOO_SOON',
      },
    },
  })
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendVerification(user.userId);
  }

  // Hồ sơ (Week9.md 1.11): chỉ tên và ngôn ngữ email. Email/role/accountStatus KHÔNG có đường vào (schema
  // bỏ field lạ, service chỉ đọc 2 field đã parse).
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Sửa hồ sơ: tên và ngôn ngữ email' })
  @ApiBody({ schema: { example: { name: 'Nguyen Van B', locale: 'en' } } })
  @ApiResponse({
    status: 200,
    description: 'Đã cập nhật, trả user mới',
    schema: {
      example: {
        success: true,
        data: { user: { ...USER_EXAMPLE, name: 'Nguyen Van B', locale: 'en' } },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Dữ liệu không hợp lệ (tên rỗng/quá dài/có ký tự không cho phép, locale lạ, hoặc không có field nào)',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.userId, dto);
  }

  // Đổi mật khẩu khi đã đăng nhập: cấp lại cặp token cho phiên HIỆN TẠI (set cookie mới), mọi refresh token
  // cũ ở thiết bị khác chết.
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({
    summary:
      'Đổi mật khẩu (cần mật khẩu hiện tại) — cấp lại token cho phiên hiện tại, thu hồi refresh token cũ',
  })
  @ApiBody({
    schema: {
      example: {
        currentPassword: 'old-password-1',
        newPassword: 'new-password-2',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Đã đổi mật khẩu, cookie token được set lại',
    schema: {
      example: { success: true, data: { message: 'Đã đổi mật khẩu' } },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Dữ liệu không hợp lệ (mật khẩu mới <8 ký tự, >72 byte, hoặc trùng mật khẩu cũ), hoặc có mã: CURRENT_PASSWORD_INCORRECT (sai mật khẩu hiện tại), PASSWORD_NOT_SET (tài khoản chỉ đăng nhập Google, chưa có mật khẩu)',
    examples: {
      validation: {
        summary: 'Dữ liệu không hợp lệ (không có code)',
        value: {
          success: false,
          data: null,
          message: 'newPassword: auth.validationNewPasswordSame',
        },
      },
      currentPasswordIncorrect: {
        summary: 'CURRENT_PASSWORD_INCORRECT',
        value: {
          success: false,
          data: null,
          message: 'The current password is incorrect',
          code: 'CURRENT_PASSWORD_INCORRECT',
        },
      },
      passwordNotSet: {
        summary: 'PASSWORD_NOT_SET',
        value: {
          success: false,
          data: null,
          message:
            'This account has no password yet; use the forgot-password flow to set one',
          code: 'PASSWORD_NOT_SET',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, ...rest } =
      await this.authService.changePassword(user.userId, dto);
    this.setTokenCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // CÔNG KHAI — luôn 200 với cùng một nội dung (xem AuthService.forgotPassword).
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Quên mật khẩu — gửi email đặt lại nếu email có tài khoản; phản hồi luôn giống nhau',
  })
  @ApiBody({ schema: { example: { email: 'user@example.com' } } })
  @ApiResponse({
    status: 200,
    description:
      'Luôn trả cùng nội dung dù email có tồn tại, tài khoản bị khoá hay đang trong thời gian chờ gửi lại',
    schema: {
      example: {
        success: true,
        data: {
          message:
            'Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email không đúng định dạng' })
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(dto);
  }

  // CÔNG KHAI — xác thực bằng token trong email. Không tự đăng nhập: FE chuyển sang /login.
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Đặt lại mật khẩu bằng token trong email (dùng một lần) — thu hồi mọi refresh token',
  })
  @ApiBody({
    schema: {
      example: { token: 'a1b2c3...', newPassword: 'new-password-2' },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { success: true, data: { message: 'Đã đặt lại mật khẩu' } },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Dữ liệu không hợp lệ (không có code), hoặc RESET_TOKEN_INVALID: token sai / hết hạn / đã dùng / tài khoản không còn hoạt động',
    examples: {
      validation: {
        summary: 'Dữ liệu không hợp lệ (không có code)',
        value: {
          success: false,
          data: null,
          message: 'newPassword: auth.validationPasswordMin',
        },
      },
      resetTokenInvalid: {
        summary: 'RESET_TOKEN_INVALID',
        value: {
          success: false,
          data: null,
          message: 'The password reset link is invalid or has expired',
          code: 'RESET_TOKEN_INVALID',
        },
      },
    },
  })
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(dto);
  }

  // accessToken/refreshToken không đưa vào response body (interceptor sẽ bọc
  // { success, data, message }) — set qua httpOnly cookie để tránh lộ token
  // cho JS phía FE (chống XSS đọc localStorage), FE chỉ nhận lại `user`.
  private setTokenCookies(res: Response, tokens: TokenPair): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      tokens.accessToken,
      accessTokenCookieOptions(),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refreshToken,
      refreshTokenCookieOptions(),
    );
  }
}
