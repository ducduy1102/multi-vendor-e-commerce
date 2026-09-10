import type { z } from 'zod';
import type { registerFormSchema } from './schemas/auth.schema';

// LoginInput/RegisterInput (request gửi BE), AuthUser (response user) dùng chung qua @ecommerce/types.
export type { LoginInput, RegisterInput, AuthUser } from '@ecommerce/types';

// RegisterFormInput: type của form register ở FE, có thêm confirmPassword (không gửi BE).
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
