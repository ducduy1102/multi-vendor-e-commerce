import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Bảo vệ route cần đăng nhập — gắn @UseGuards(JwtAuthGuard), req.user sẽ có
// { userId, role } (từ JwtStrategy). Áp dụng per-route, không đăng ký global,
// vì phần lớn API (browse sản phẩm...) vẫn cho Guest truy cập được.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
