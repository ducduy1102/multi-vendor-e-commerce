import { z } from 'zod';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@ecommerce/types';

// Dùng thẳng schema BE cho login và quên mật khẩu — không có field nào riêng ở FE.
export { forgotPasswordSchema, loginSchema };

// Form register cần thêm confirmPassword để UX check khớp mật khẩu ngay trên FE,
// field này không gửi lên BE (đã lược bỏ trước khi gọi API ở services/).
export const registerFormSchema = registerSchema
  .extend({
    confirmPassword: z.string().min(1, 'auth.validationConfirmPasswordRequired'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'auth.validationConfirmPasswordMismatch',
    path: ['confirmPassword'],
  });

// Form đặt lại mật khẩu: `token` lấy từ URL (container truyền vào lúc gọi API), không phải field người
// dùng nhập nên chỉ lấy `newPassword` từ schema BE (cùng luật 8–72 ký tự/byte với đăng ký) — confirmPassword
// chỉ ở FE như form đăng ký. Giữ input === output (không transform) để `zodResolver` khớp generic của form.
export const resetPasswordFormSchema = resetPasswordSchema
  .pick({ newPassword: true })
  .extend({
    confirmPassword: z.string().min(1, 'auth.validationConfirmPasswordRequired'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'auth.validationConfirmPasswordMismatch',
    path: ['confirmPassword'],
  });
