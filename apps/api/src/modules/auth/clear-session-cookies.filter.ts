import { ArgumentsHost, Catch, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllExceptionsFilter } from '../../shared/filters/all-exceptions.filter';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearTokenCookieOptions,
} from './auth.constants';

// Chỉ gắn vào `POST /auth/refresh` (Week10.md 2.1). Khi gia hạn bị từ chối (refresh token hết hạn / đã xoay /
// đã thu hồi) mà request THẬT SỰ có gửi cookie `refresh_token`, ngoài 401 còn xoá luôn cả hai cookie phiên.
//
// Vì sao cần: cookie `refresh_token` là httpOnly (JS không xoá được) và sống 7 ngày, còn `POST /auth/logout`
// dùng JwtAuthGuard nên không chạy được khi access token đã hết hạn. Không có bước này, cookie chết nằm lại
// trình duyệt, khiến proxy.ts (cho người "còn dấu vết phiên" vào route cần đăng nhập) mỗi lần lại cho vào rồi
// client lại thử gia hạn và thất bại.
//
// Vì sao điều kiện "có gửi cookie" vẫn an toàn: cookie `SameSite=Lax` không được trình duyệt đính kèm vào
// request POST từ site khác, nên một trang ngoài không thể dùng endpoint này để "đăng xuất" người dùng
// (logout CSRF). Request không có cookie thì 401 trơn, không `Set-Cookie`.
//
// Kế thừa AllExceptionsFilter để body lỗi giữ đúng format chuẩn { success, data, message } (filter ở mức
// route thay thế filter global cho exception khớp `@Catch`, không chạy cả hai).
@Catch(UnauthorizedException)
export class ClearSessionCookiesFilter extends AllExceptionsFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;

    if (cookies?.[REFRESH_TOKEN_COOKIE]) {
      const response = http.getResponse<Response>();
      response.clearCookie(ACCESS_TOKEN_COOKIE, clearTokenCookieOptions());
      response.clearCookie(REFRESH_TOKEN_COOKIE, clearTokenCookieOptions());
    }

    super.catch(exception, host);
  }
}
