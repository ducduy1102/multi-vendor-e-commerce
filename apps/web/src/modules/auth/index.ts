// Barrel export cho module auth — export component/hook cần dùng ở app/.
export { AuthHydrator } from './components/AuthHydrator';
export { EmailVerificationBanner } from './components/EmailVerificationBanner';
export { GoogleLoginButton } from './components/GoogleLoginButton';
export { LoginForm } from './components/LoginForm';
export { LoginFormContainer } from './components/LoginFormContainer';
export { LogoutButton } from './components/LogoutButton';
export { RegisterForm } from './components/RegisterForm';
export { RegisterFormContainer } from './components/RegisterFormContainer';
export { ResendVerificationButton } from './components/ResendVerificationButton';
export { VerifyEmailStatus } from './components/VerifyEmailStatus';
export { loginSchema, registerFormSchema } from './schemas/auth.schema';
export * as authService from './services/auth.service';
export { useAuthStore } from './store/auth.store';
export type { LoginInput, RegisterInput, RegisterFormInput, AuthUser } from './types';
