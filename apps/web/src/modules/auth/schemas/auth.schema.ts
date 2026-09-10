import { z } from 'zod';
import { loginSchema, registerSchema } from '@ecommerce/types';

// Dùng thẳng schema BE cho login — không có field nào riêng ở FE.
export { loginSchema };

// Form register cần thêm confirmPassword để UX check khớp mật khẩu ngay trên FE,
// field này không gửi lên BE (đã lược bỏ trước khi gọi API ở services/).
export const registerFormSchema = registerSchema
  .extend({
    confirmPassword: z.string().min(1, 'Vui lòng nhập lại mật khẩu'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  });
