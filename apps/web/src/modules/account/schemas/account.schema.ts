import { PASSWORD_INPUT_MAX_LENGTH, registerSchema } from '@ecommerce/types';
import { z } from 'zod';

// Form hồ sơ: dùng đúng luật `name` và `locale` của BE (cùng schema đăng ký, nên tên không được chứa ký tự
// điều khiển/`<>`, tối đa 100 ký tự) — không khai lại. Khác đăng ký ở chỗ ô ngôn ngữ luôn có giá trị (form
// luôn điền sẵn), nên `locale` bắt buộc thay vì optional. Input === output, không transform, để
// `zodResolver` khớp generic của `useForm` (rules/frontend.md mục 4).
export const profileFormSchema = registerSchema
  .pick({ name: true, locale: true })
  .required({ locale: true });
export type ProfileFormInput = z.infer<typeof profileFormSchema>;

// Form đổi mật khẩu: mật khẩu mới theo đúng luật 8–72 ký tự/byte của đăng ký và đặt lại (bcrypt chỉ đọc 72
// byte đầu); mật khẩu hiện tại chỉ bị chặn ở mức vô lý như BE (tài khoản cũ có thể dài hơn 72). Nhập lại
// mật khẩu chỉ là UX nên không gửi lên BE (Container tự lược trước khi gọi service).
export const changePasswordFormSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'auth.validationPasswordRequired')
      .max(PASSWORD_INPUT_MAX_LENGTH, 'auth.validationPasswordMax'),
    newPassword: registerSchema.shape.password,
    confirmPassword: z.string().min(1, 'auth.validationConfirmPasswordRequired'),
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'auth.validationNewPasswordSame',
    path: ['newPassword'],
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'auth.validationConfirmPasswordMismatch',
    path: ['confirmPassword'],
  });
export type ChangePasswordFormInput = z.infer<typeof changePasswordFormSchema>;
