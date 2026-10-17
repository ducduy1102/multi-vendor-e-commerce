// Type request/response dùng chung qua @ecommerce/types — không định nghĩa lại. Type của form riêng của
// module (có thêm field chỉ phục vụ FE như confirmPassword) suy ra từ schema ở ./schemas/account.schema.
export type { ChangePasswordInput, UpdateProfileInput, UserLocale } from '@ecommerce/types';
export type { ChangePasswordFormInput, ProfileFormInput } from './schemas/account.schema';
