import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Chỉ dùng cho POST /auth/refresh — validate bằng JWT_REFRESH_SECRET
// (RefreshTokenStrategy), tách biệt hoàn toàn khỏi JwtAuthGuard.
@Injectable()
export class RefreshTokenGuard extends AuthGuard('jwt-refresh') {}
