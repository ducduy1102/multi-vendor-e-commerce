import type { z } from 'zod';
import type { registerFormSchema, resetPasswordFormSchema } from './schemas/auth.schema';

// LoginInput/RegisterInput (request gửi BE), AuthUser (response user) dùng chung qua @ecommerce/types.
export type {
  LoginInput,
  RegisterInput,
  AuthUser,
  ForgotPasswordInput,
  ResetPasswordInput,
} from '@ecommerce/types';

// RegisterFormInput: type của form register ở FE, có thêm confirmPassword (không gửi BE).
export type RegisterFormInput = z.infer<typeof registerFormSchema>;

// ResetPasswordFormInput: form đặt lại mật khẩu — chỉ mật khẩu mới + nhập lại; token lấy từ URL.
export type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;
