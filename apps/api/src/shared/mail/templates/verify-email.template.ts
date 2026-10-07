import { escapeHtml } from './html';

// `name` do người đăng ký tự nhập — và email này gửi tới ĐỊA CHỈ ĐƯỢC KHAI lúc đăng ký (có thể là của
// người khác): nếu không escape, kẻ tấn công đăng ký bằng email của nạn nhân kèm tên chứa HTML sẽ chèn
// được link/nội dung tuỳ ý vào email xác thực gửi từ chính địa chỉ của sàn (phishing). `verifyUrl` do
// server dựng nhưng vẫn escape vì nằm trong thuộc tính href (ký tự `&` phải là `&amp;` mới đúng HTML).
export function verifyEmailTemplate(
  name: string,
  verifyUrl: string,
): { subject: string; html: string } {
  const safeUrl = escapeHtml(verifyUrl);
  return {
    subject: 'Xác thực email của bạn',
    html: `
      <p>Chào ${escapeHtml(name)},</p>
      <p>Vui lòng bấm vào link bên dưới để xác thực email (link hết hạn sau 24 giờ):</p>
      <p><a href="${safeUrl}">${safeUrl}</a></p>
      <p>Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p>
    `,
  };
}
