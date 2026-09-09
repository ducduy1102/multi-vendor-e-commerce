import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
}

// req.user sau khi qua JwtAuthGuard/RefreshTokenGuard — dùng cho @CurrentUser().
export interface AuthenticatedUser {
  userId: string;
  role: Role;
}
