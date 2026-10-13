import { z } from 'zod';
import { isSafeName, utf8ByteLength } from './text-safety';

// Ngôn ngữ dùng để GỬI EMAIL cho user (Week9.md 1.12) — khớp enum Prisma `UserLocale` (test parity ở BE).
// Không phải ngôn ngữ giao diện: LocaleSwitcher ở FE vẫn chỉ đổi giao diện.
export const USER_LOCALES = ['vi', 'en'] as const;
export const userLocaleSchema = z.enum(USER_LOCALES, { message: 'auth.validationLocaleInvalid' });
export type UserLocale = z.infer<typeof userLocaleSchema>;

// Giới hạn độ dài là phòng thủ chống chuỗi khổng lồ đi vào DB/bcrypt/email, và là hợp đồng chung của mọi
// nơi nhận tên/email/mật khẩu (đăng ký, sửa hồ sơ, quên mật khẩu).
export const USER_NAME_MAX_LENGTH = 100;
// RFC 5321: địa chỉ email tối đa 254 ký tự.
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt chỉ đọc 72 BYTE đầu (không phải ký tự) — xem utf8ByteLength.
export const PASSWORD_MAX_BYTES = 72;
// Mật khẩu HIỆN TẠI (đang đăng nhập/đổi mật khẩu) chỉ bị chặn ở mức vô lý: tài khoản cũ có thể đặt mật khẩu
// dài hơn 72 ký tự từ trước khi có luật (bcrypt cắt ở 72 byte nhưng đăng nhập vẫn phải gõ đủ).
export const PASSWORD_INPUT_MAX_LENGTH = 1024;
// Token đặt lại mật khẩu do BE sinh (randomBytes(32) ⇒ 64 ký tự hex); chặn độ dài trước khi băm. Không kiểm
// định dạng ở schema: token sai/lạ phải ra cùng một mã lỗi RESET_TOKEN_INVALID với token hết hạn/đã dùng.
export const PASSWORD_RESET_TOKEN_MAX_LENGTH = 128;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, 'auth.validationEmailInvalid')
  .email('auth.validationEmailInvalid');

// Tên hiển thị: không ký tự điều khiển/giả mạo chiều chữ/`<>` (xem text-safety.ts).
const personNameSchema = z
  .string()
  .trim()
  .min(1, 'auth.validationNameRequired')
  .max(USER_NAME_MAX_LENGTH, 'auth.validationNameTooLong')
  .refine(isSafeName, 'auth.validationNameInvalid');

// Mật khẩu MỚI (đăng ký, đổi, đặt lại). Không trim — khoảng trắng đầu/cuối là một phần của mật khẩu.
// `.max(72)` giữ thông điệp cũ cho ca ASCII; ca nhiều byte (dấu tiếng Việt, emoji) rơi vào kiểm byte bên dưới.
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'auth.validationPasswordMin')
  .max(PASSWORD_MAX_BYTES, 'auth.validationPasswordMax')
  .refine(
    (value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
    'auth.validationPasswordMaxBytes',
  );

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: personNameSchema,
  // Ngôn ngữ giao diện hiện tại của người đăng ký (FE gửi `useLocale()`); bỏ trống ⇒ BE dùng 'vi'.
  locale: userLocaleSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'auth.validationPasswordRequired'),
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
  // Ngôn ngữ email của user (Week9.md 1.12), sửa được ở /account.
  locale: userLocaleSchema,
  // `passwordHash != null`, BE tính trước khi strip hash — FE chọn "Đổi mật khẩu" hay "Đặt mật khẩu"
  // (tài khoản chỉ đăng nhập Google chưa có mật khẩu). Không bao giờ trả chính hash.
  hasPassword: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'auth.validationTokenInvalid'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// `PATCH /auth/me` — chỉ tên và ngôn ngữ email. Email KHÔNG sửa được ở đây (đổi email cần xác thực lại,
// chuyển giao); role/accountStatus không bao giờ nhận từ client: z.object tự bỏ field lạ nên body
// `{"role":"ADMIN"}` không tới được service. Ít nhất một field, nếu không PATCH rỗng là no-op khó hiểu.
export const updateProfileSchema = z
  .object({
    name: personNameSchema.optional(),
    locale: userLocaleSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.locale !== undefined, {
    message: 'auth.validationProfileEmpty',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// `POST /auth/change-password` — người đã đăng nhập. Mật khẩu mới phải khác mật khẩu hiện tại; xác nhận
// nhập lại mật khẩu mới chỉ là UX nên nằm ở schema form FE, không gửi lên BE.
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'auth.validationPasswordRequired')
      .max(PASSWORD_INPUT_MAX_LENGTH, 'auth.validationPasswordMax'),
    newPassword: passwordSchema,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'auth.validationNewPasswordSame',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// `POST /auth/forgot-password` (công khai). Response luôn giống nhau dù email có tồn tại hay không.
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// `POST /auth/reset-password` (công khai). Token sai / hết hạn / đã dùng đều ra RESET_TOKEN_INVALID ở BE.
export const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'auth.validationTokenInvalid')
    .max(PASSWORD_RESET_TOKEN_MAX_LENGTH, 'auth.validationTokenInvalid'),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
