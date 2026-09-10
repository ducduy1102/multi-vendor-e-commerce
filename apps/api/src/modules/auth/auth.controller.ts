import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
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
import type { AuthenticatedUser } from './types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 201: tạo mới User
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, ...rest } =
      await this.authService.register(dto);
    this.setTokenCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // Mặc định NestJS trả 201 cho POST — login/refresh/logout là action,
  // không tạo resource mới, nên ép về 200 (đúng checklist RESTful mục 2).
  @Post('login')
  @HttpCode(HttpStatus.OK)
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
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.userId);
    res.clearCookie(ACCESS_TOKEN_COOKIE, accessTokenCookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE, refreshTokenCookieOptions());
    return { message: 'Đăng xuất thành công' };
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
