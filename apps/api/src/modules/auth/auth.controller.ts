import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service';

// Route handler cho /auth/* — chỉ nhận request, gọi AuthService, trả response.
// Endpoint cụ thể (register/login/refresh/logout) thêm ở Bước 2.6.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
}
