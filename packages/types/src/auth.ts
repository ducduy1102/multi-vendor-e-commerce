import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .max(72, 'Mật khẩu tối đa 72 ký tự'), // giới hạn input mà bcrypt thực sự đọc
  name: z.string().trim().min(1, 'Tên không được để trống'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Field của User trả về sau register/login/refresh (accessToken/refreshToken
// không nằm trong response body — set qua httpOnly cookie, xem AuthController).
// Role hiện chỉ có USER/ADMIN theo enum Role thật trong schema.prisma — SELLER
// sẽ thêm khi làm luồng onboarding Seller (Phase 1, roadmap Tuần 3).
export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['USER', 'ADMIN']),
});
export type AuthUser = z.infer<typeof authUserSchema>;
