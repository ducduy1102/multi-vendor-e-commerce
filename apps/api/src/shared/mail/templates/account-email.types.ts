import type { MailLocale } from '../mail-locale';

// Dữ liệu cho email tài khoản và trạng thái shop (Week9.md 1.11–1.13). Khai ở `shared/mail` (hạ tầng không
// được import `modules/`). `locale` BẮT BUỘC, không có mặc định — xem `OrderEmailBase`. Mọi URL đã được người
// gọi dựng bằng `frontendUrl` (đúng prefix ngôn ngữ).

export interface PasswordResetEmailData {
  locale: MailLocale;
  name: string;
  // Link đặt lại mật khẩu chứa token dùng một lần.
  resetUrl: string;
  // Số phút còn hiệu lực — nói rõ trong email để người dùng biết phải làm ngay.
  expiresInMinutes: number;
}

// Email bảo mật gửi cho CHÍNH CHỦ sau mỗi lần đổi mật khẩu thành công. KHÔNG chứa mật khẩu hay token.
export interface PasswordChangedEmailData {
  locale: MailLocale;
  name: string;
  // Link tới trang "quên mật khẩu" cho người không phải mình đổi.
  forgotPasswordUrl: string;
}

// APPROVED: PENDING → APPROVED. REJECTED: PENDING → REJECTED (kèm lý do). SUSPENDED: APPROVED → SUSPENDED
// (kèm lý do). REINSTATED: SUSPENDED → APPROVED (mở khoá).
export type ShopStatusEmailKind =
  'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REINSTATED';

export interface ShopStatusEmailData {
  locale: MailLocale;
  ownerName: string;
  shopName: string;
  kind: ShopStatusEmailKind;
  // Lý do Admin nhập; bắt buộc có ở REJECTED/SUSPENDED (BE kiểm), null ở hai loại còn lại.
  reason: string | null;
  // Link tới trang quản lý shop của chủ shop.
  shopUrl: string;
}

// Email báo CHÍNH CHỦ khi Admin đổi trạng thái tài khoản (Week11.md 3.3). SUSPENDED: tạm khoá. BANNED: cấm (mở lại phải
// được xét lại). REACTIVATED: mở lại về ACTIVE. Cố ý không có loại cho DEACTIVATED: người dùng tự xoá tài khoản không đi
// qua Admin.
export type AccountStatusEmailKind = 'SUSPENDED' | 'BANNED' | 'REACTIVATED';

export interface AccountStatusEmailData {
  locale: MailLocale;
  name: string;
  kind: AccountStatusEmailKind;
  // Lý do Admin nhập (văn bản thuần, có thể nhiều dòng); luôn có ở cả ba loại vì lý do là bắt buộc khi khoá lẫn khi mở.
  reason: string;
  // Địa chỉ hỗ trợ từ ENV `SUPPORT_EMAIL` (xem `getSupportEmail`); null ⇒ không có dòng liên hệ nào. Chỉ hiện ở email khoá /
  // cấm, vì chỉ lúc đó người nhận cần một đường để phản hồi.
  supportEmail: string | null;
  // Link trang đăng nhập (đã dựng bằng `frontendUrl`, đúng prefix ngôn ngữ). Chỉ dùng ở REACTIVATED: người bị khoá không
  // đăng nhập được nên email khoá không có nút.
  loginUrl: string;
  // Một câu nói thêm về SHOP của người nhận khi việc đổi trạng thái tài khoản kéo theo shop (Week11.md 3.4); null ⇒ không có
  // câu nào (người nhận không có shop, hoặc shop không bị động tới). SUSPENDED: shop cũng bị tạm ngừng. REOPENED: shop do
  // chính lần khoá này khoá đã được mở lại. STILL_SUSPENDED: tài khoản được mở lại từ trạng thái bị CẤM nên shop KHÔNG tự mở,
  // báo trước để người dùng khỏi ngạc nhiên khi vào lại thấy shop vẫn bị khoá.
  shopNotice: AccountStatusShopNotice | null;
}

export type AccountStatusShopNotice =
  'SUSPENDED' | 'REOPENED' | 'STILL_SUSPENDED';
