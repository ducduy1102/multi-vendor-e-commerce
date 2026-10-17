import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';

interface Copy {
  subject: string;
  greeting: (escapedName: string) => string;
  instruction: string;
  ignore: string;
}

// Mỗi chuỗi đã là HTML (`escapedName` do hàm gọi escape trước) — xem chú thích bên dưới về lý do escape.
const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: 'Xác thực email của bạn',
    greeting: (escapedName) => `Chào ${escapedName},`,
    instruction:
      'Vui lòng bấm vào link bên dưới để xác thực email (link hết hạn sau 24 giờ):',
    ignore: 'Nếu bạn không tạo tài khoản này, hãy bỏ qua email.',
  },
  en: {
    subject: 'Verify your email',
    greeting: (escapedName) => `Hi ${escapedName},`,
    instruction:
      'Please click the link below to verify your email (the link expires in 24 hours):',
    ignore: "If you didn't create this account, you can ignore this email.",
  },
};

// `name` do người đăng ký tự nhập — và email này gửi tới ĐỊA CHỈ ĐƯỢC KHAI lúc đăng ký (có thể là của
// người khác): nếu không escape, kẻ tấn công đăng ký bằng email của nạn nhân kèm tên chứa HTML sẽ chèn
// được link/nội dung tuỳ ý vào email xác thực gửi từ chính địa chỉ của sàn (phishing). `verifyUrl` do
// server dựng nhưng vẫn escape vì nằm trong thuộc tính href (ký tự `&` phải là `&amp;` mới đúng HTML).
export function verifyEmailTemplate(
  name: string,
  verifyUrl: string,
  locale: MailLocale,
): { subject: string; html: string } {
  const copy = COPY[locale];
  const safeUrl = escapeHtml(verifyUrl);
  return {
    subject: copy.subject,
    html: `
      <p>${copy.greeting(escapeHtml(name))}</p>
      <p>${escapeHtml(copy.instruction)}</p>
      <p><a href="${safeUrl}">${safeUrl}</a></p>
      <p>${escapeHtml(copy.ignore)}</p>
    `,
  };
}
