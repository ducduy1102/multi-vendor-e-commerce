import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RefreshTokenGuard } from '../../shared/guards/refresh-token.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from './auth.constants';
import { AuthService, type TokenPair } from './auth.service';
import { loginSchema, type LoginDto } from './dto/login.dto';
import { registerSchema, type RegisterDto } from './dto/register.dto';
import { verifyEmailSchema, type VerifyEmailDto } from './dto/verify-email.dto';
import type { AuthenticatedUser } from './types/jwt-payload.type';

// DTO validate bằng Zod (không phải class), @nestjs/swagger không tự suy ra
// schema từ class được nên khai @ApiBody bằng example thủ công thay vì
// @ApiBody({ type: RegisterDto }).
const USER_EXAMPLE = {
  id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER',
  accountStatus: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
    description: 'Email đã được sử dụng, hoặc dữ liệu không hợp lệ',
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
      'Email hoặc mật khẩu không đúng, hoặc tài khoản không ở trạng thái ACTIVE (message: "ACCOUNT_NOT_ACTIVE")',
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
    description: 'refresh_token không hợp lệ hoặc hết hạn',
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
    res.clearCookie(ACCESS_TOKEN_COOKIE, accessTokenCookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE, refreshTokenCookieOptions());
    return { message: 'Đăng xuất thành công' };
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
      'Chưa đăng nhập, session hết hạn, hoặc tài khoản không còn ACTIVE (message: "ACCOUNT_NOT_ACTIVE")',
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
    description: 'Token không hợp lệ hoặc đã hết hạn',
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
  @ApiResponse({ status: 400, description: 'Email đã được xác thực' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 429,
    description: 'Gửi quá nhanh, vui lòng đợi rồi thử lại',
  })
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendVerification(user.userId);
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
