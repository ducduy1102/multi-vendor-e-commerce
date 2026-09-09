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
