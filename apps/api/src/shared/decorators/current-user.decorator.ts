import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload.type';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

// @CurrentUser() trong handler param — lấy req.user do JwtAuthGuard set sẵn.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);

interface RequestWithOptionalUser extends Request {
  user?: AuthenticatedUser;
}

// @CurrentUserOptional() — dùng sau OptionalJwtAuthGuard (route public vẫn
// muốn biết viewer nếu có đăng nhập, vd ProductController.getOne). Khác
// @CurrentUser(): trả undefined thay vì luôn có giá trị.
export const CurrentUserOptional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithOptionalUser>();
    return request.user;
  },
);
