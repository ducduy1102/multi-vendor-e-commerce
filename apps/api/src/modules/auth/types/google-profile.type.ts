// Kết quả GoogleStrategy.validate() trả về — set vào req.user, KHÁC hẳn
// AuthenticatedUser (đó là user hệ thống mình đã có userId/role, cái này là
// thông tin thô Google trả về, chưa map sang User của mình).
export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
}
