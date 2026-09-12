import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .max(72, 'Mật khẩu tối đa 72 ký tự'), // giới hạn input mà bcrypt thực sự đọc
  name: z.string().trim().min(1, 'Tên không được để trống'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Field của User trả về sau register/login/refresh (accessToken/refreshToken
// không nằm trong response body — set qua httpOnly cookie, xem AuthController).
// Role chỉ có USER/ADMIN — quyết định cố định (xem note-db.md mục 4), KHÔNG
// thêm SELLER: "có phải seller không" suy ra từ việc user đó sở hữu ít nhất 1
// Shop (User 1-n Shop), không model bằng role riêng (1 tài khoản vừa mua vừa
// bán được cùng lúc, giống Shopee/Lazada/Tiki thật).
export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['USER', 'ADMIN']),
  // null = chưa xác thực email (vẫn cho login/browse — feature-level, xem
  // auth-shop-status-architecture.md), FE dùng field này để hiện nhắc nhở.
  emailVerifiedAt: z.string().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token không hợp lệ'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
