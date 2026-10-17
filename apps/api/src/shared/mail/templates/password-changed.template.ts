import type { MailLocale } from '../mail-locale';
import type { PasswordChangedEmailData } from './account-email.types';
import { button, paragraph, renderEmail } from './order-email.layout';

interface Copy {
  subject: string;
  greeting: (name: string) => string;
  lead: string;
  noAction: string;
  notYou: string;
  action: string;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: 'Mật khẩu của bạn đã được thay đổi',
    greeting: (name) => `Chào ${name},`,
    lead: 'Mật khẩu của tài khoản của bạn vừa được thay đổi.',
    noAction: 'Nếu chính bạn thực hiện, bạn không cần làm gì thêm.',
    notYou:
      'Nếu không phải bạn, tài khoản của bạn có thể đang bị truy cập trái phép. Hãy đặt lại mật khẩu ngay để bảo vệ tài khoản:',
    action: 'Đặt lại mật khẩu',
  },
  en: {
    subject: 'Your password was changed',
    greeting: (name) => `Hi ${name},`,
    lead: 'The password of your account was just changed.',
    noAction: 'If you made this change, you do not need to do anything else.',
    notYou:
      'If this was not you, someone else may have access to your account. Reset your password right away to protect it:',
    action: 'Reset password',
  },
};

// Email bảo mật sau mỗi lần đổi/đặt lại mật khẩu thành công (Week9.md 1.11). KHÔNG chứa mật khẩu hay token —
// chỉ báo cho chính chủ biết để phát hiện sớm khi tài khoản bị chiếm.
export function passwordChangedTemplate(data: PasswordChangedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const html = renderEmail(
    copy.subject,
    `
      ${paragraph(copy.greeting(data.name))}
      ${paragraph(copy.lead)}
      ${paragraph(copy.noAction)}
      ${paragraph(copy.notYou)}
      ${button(data.forgotPasswordUrl, copy.action)}
    `,
    data.locale,
  );
  return { subject: copy.subject, html };
}
