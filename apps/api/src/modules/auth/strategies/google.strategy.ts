import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import type { GoogleProfile } from '../types/google-profile.type';

// Đăng ký trong AuthModule với tên mặc định 'google', dùng qua GoogleAuthGuard
// cho cả GET /auth/google (redirect sang Google) lẫn GET /auth/google/callback.
//
// clientID/clientSecret fallback về chuỗi giả khi thiếu ENV thay vì để
// constructor throw — thư viện passport-oauth2 (nền của lib này) throw ngay
// nếu thiếu, và GoogleStrategy là provider khởi tạo eager lúc app bootstrap
// (đăng ký trong AuthModule.providers) nên sẽ sập CẢ APP nếu chưa cấu hình
// Google OAuth, y hệt bug đã fix ở ResendMailProvider (Bước 2.10) — chỉ khác
// là ResendMailProvider khởi tạo lazy được, còn Strategy này thì không (bắt
// buộc phải super() với đủ option trong constructor). Chấp nhận: thiếu ENV
// thật thì gọi /auth/google sẽ lỗi rõ ràng lúc đó, không phải lúc bootstrap.
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID?.trim() || 'not-configured',
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET?.trim() || 'not-configured',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL?.trim() ||
        'http://localhost:4000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Tài khoản Google không có email công khai'), false);
      return;
    }

    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      name: profile.displayName,
    };
    done(null, googleProfile);
  }
}
