// Barrel export cho module account (Week9.md Bước 6) — export những gì app/ cần để ghép trang /account*.
// Module này chỉ ghép UI trên hook/component đã có của module khác — checkout (hook địa chỉ, AddressForm)
// và auth (ResendVerificationButton, useAuthStore) — và chỉ qua barrel của chúng. auth và checkout không
// được import ngược account để đồ thị không có vòng (shared/lib/module-boundaries.test.ts kiểm điều này).
export { AccountNav } from './components/AccountNav';
export { AddressBookContainer } from './components/AddressBookContainer';
export { ChangePasswordFormContainer } from './components/ChangePasswordFormContainer';
export { ProfileFormContainer } from './components/ProfileFormContainer';
export { useChangePassword } from './hooks/useChangePassword';
export { useUpdateProfile } from './hooks/useUpdateProfile';
export { changePasswordFormSchema, profileFormSchema } from './schemas/account.schema';
export * as accountService from './services/account.service';
export type {
  ChangePasswordFormInput,
  ChangePasswordInput,
  ProfileFormInput,
  UpdateProfileInput,
  UserLocale,
} from './types';
