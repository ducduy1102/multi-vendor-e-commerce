import { Role } from '@prisma/client';

// `role` ở đây chỉ là bản chụp lúc cấp token (FE đọc để định tuyến) — KHÔNG dùng làm căn cứ phân quyền;
// JwtStrategy đọc lại role từ DB ở mọi request.
export interface JwtPayload {
  sub: string;
  role: Role;
}

// req.user sau khi qua JwtAuthGuard/RefreshTokenGuard — dùng cho @CurrentUser().
export interface AuthenticatedUser {
  userId: string;
  role: Role;
}
