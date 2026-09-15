import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload.type';

// Dùng cho route PUBLIC muốn "biết thêm" nếu có người đăng nhập (vd
// ProductController.getOne — chủ shop xem được product của mình dù đang
// DRAFT) nhưng KHÔNG bắt buộc đăng nhập. Khác JwtAuthGuard thường: không có
// cookie hợp lệ (thiếu/hết hạn/tài khoản bị khoá...) thì req.user =
// undefined (coi như guest), không throw 401 — canActivate luôn true.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser | undefined>(
    _err: unknown,
    user: AuthenticatedUser | false,
  ): TUser {
    return (user || undefined) as TUser;
  }
}
