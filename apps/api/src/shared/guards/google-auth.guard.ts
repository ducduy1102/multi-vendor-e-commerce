import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { safeNextPath } from '@ecommerce/types';
import type { Request } from 'express';

// Dùng cho GET /auth/google (redirect người dùng sang Google) và
// GET /auth/google/callback (Google redirect lại, guard verify code +
// gọi GoogleStrategy.validate(), set req.user = GoogleProfile).
//
// `?next=` (đích quay lại sau đăng nhập, Week7.md 1.2) đi vòng qua Google bằng tham số OAuth
// `state`: API stateless nên không dùng session/cookie. GoogleStrategy không bật `state` của
// passport-oauth2 (không có state store) nên `state` ở đây CHỈ là chỗ mang `next`, KHÔNG phải cơ chế
// chống CSRF — an toàn vì `next` bị kiểm nội bộ bằng safeNextPath ở cả 2 đầu (ở đây và ở callback,
// vì dữ liệu đi vòng qua trình duyệt/Google không được tin).
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(
    context: ExecutionContext,
  ): { state: string } | undefined {
    const req = context.switchToHttp().getRequest<Request>();
    const next = safeNextPath(req.query.next);
    return next ? { state: next } : undefined;
  }
}
