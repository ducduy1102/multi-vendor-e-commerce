// Barrel export cho module auth — export component/hook cần dùng ở app/.
export { AuthHydrator } from './components/AuthHydrator';
export { EmailVerificationBanner } from './components/EmailVerificationBanner';
export { ForgotPasswordForm } from './components/ForgotPasswordForm';
export { ForgotPasswordFormContainer } from './components/ForgotPasswordFormContainer';
export { GoogleLoginButton } from './components/GoogleLoginButton';
export { LoginForm } from './components/LoginForm';
export { LoginFormContainer } from './components/LoginFormContainer';
export { LogoutButton } from './components/LogoutButton';
export { RegisterForm } from './components/RegisterForm';
export { RegisterFormContainer } from './components/RegisterFormContainer';
export { ResendVerificationButton } from './components/ResendVerificationButton';
export { ResetPasswordForm } from './components/ResetPasswordForm';
export { ResetPasswordFormContainer } from './components/ResetPasswordFormContainer';
export { VerifyEmailStatus } from './components/VerifyEmailStatus';
export { useLogout } from './hooks/useLogout';
export {
  forgotPasswordSchema,
  loginSchema,
  registerFormSchema,
  resetPasswordFormSchema,
} from './schemas/auth.schema';
export * as authService from './services/auth.service';
export { useAuthStore } from './store/auth.store';
export type {
  AuthUser,
  ForgotPasswordInput,
  LoginInput,
  RegisterFormInput,
  RegisterInput,
  ResetPasswordFormInput,
  ResetPasswordInput,
} from './types';
