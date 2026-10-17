import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';
import type { PasswordResetEmailData } from './account-email.types';
import { button, paragraph, renderEmail } from './order-email.layout';

interface Copy {
  subject: string;
  greeting: (name: string) => string;
  lead: (minutes: number) => string;
  action: string;
  fallback: string;
  ignore: string;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: 'Đặt lại mật khẩu của bạn',
    greeting: (name) => `Chào ${name},`,
    lead: (minutes) =>
      `Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Bấm nút bên dưới để đặt mật khẩu mới (liên kết hết hạn sau ${minutes} phút và chỉ dùng được một lần).`,
    action: 'Đặt lại mật khẩu',
    fallback:
      'Nếu nút không hoạt động, hãy sao chép liên kết sau vào trình duyệt:',
    ignore:
      'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn sẽ không thay đổi.',
  },
  en: {
    subject: 'Reset your password',
    greeting: (name) => `Hi ${name},`,
    lead: (minutes) =>
      `We received a request to reset the password of your account. Click the button below to choose a new password (the link expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and can only be used once).`,
    action: 'Reset password',
    fallback: "If the button doesn't work, copy this link into your browser:",
    ignore:
      "If you didn't request this, you can ignore this email — your password will not change.",
  },
};

// Link đặt lại mật khẩu. `name` do người dùng tự nhập và mail gửi tới ĐỊA CHỈ được khai (có thể là của người
// khác) nên mọi giá trị chèn vào đều qua escapeHtml (paragraph/button/escapeHtml) — xem html.ts.
export function passwordResetTemplate(data: PasswordResetEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const safeUrl = escapeHtml(data.resetUrl);
  const html = renderEmail(
    copy.subject,
    `
      ${paragraph(copy.greeting(data.name))}
      ${paragraph(copy.lead(data.expiresInMinutes))}
      ${button(data.resetUrl, copy.action)}
      <p style="margin:0 0 4px;font-size:13px">${escapeHtml(copy.fallback)}</p>
      <p style="margin:0 0 12px;font-size:13px;word-break:break-all"><a href="${safeUrl}">${safeUrl}</a></p>
      ${paragraph(copy.ignore)}
    `,
    data.locale,
  );
  return { subject: copy.subject, html };
}
