// Barrel export cho module account (Week9.md Bước 6). Hiện rỗng: component/hook/service được thêm và
// export ở 6.2. Module này chỉ ghép UI trên hook/component đã có của module khác — checkout (hook địa
// chỉ, AddressForm) và auth (ResendVerificationButton, useAuthStore) — và chỉ qua barrel của chúng.
// auth và checkout không được import ngược account để đồ thị không có vòng
// (shared/lib/module-boundaries.test.ts kiểm điều này).
export {};
