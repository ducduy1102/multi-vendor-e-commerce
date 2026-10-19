import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { safeNextPath } from '@ecommerce/types';
import type { Request } from 'express';
import { encodeOAuthState, parseOAuthLocale } from '../utils/oauth-state';

// Dùng cho GET /auth/google (redirect người dùng sang Google) và
// GET /auth/google/callback (Google redirect lại, guard verify code +
// gọi GoogleStrategy.validate(), set req.user = GoogleProfile).
//
// `?next=` (đích quay lại sau đăng nhập, Week7.md 1.2) và `?locale=` (ngôn ngữ của trang bấm nút, Week10.md
// 2.3) đi vòng qua Google bằng tham số OAuth `state`: API stateless nên không dùng session/cookie.
// GoogleStrategy không bật `state` của passport-oauth2 (không có state store) nên `state` ở đây CHỈ là chỗ
// mang dữ liệu, KHÔNG phải cơ chế chống CSRF — an toàn vì cả hai giá trị bị kiểm lại ở 2 đầu (ở đây và ở
// callback: `next` bằng safeNextPath, `locale` bằng danh sách ngôn ngữ hỗ trợ), vì dữ liệu đi vòng qua
// trình duyệt/Google không được tin. Định dạng `state` xem utils/oauth-state.ts.
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(
    context: ExecutionContext,
  ): { state: string } | undefined {
    const req = context.switchToHttp().getRequest<Request>();
    const state = encodeOAuthState({
      next: safeNextPath(req.query.next),
      locale: parseOAuthLocale(req.query.locale),
    });
    return state ? { state } : undefined;
  }
}
