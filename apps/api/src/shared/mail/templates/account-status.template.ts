import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';
import type {
  AccountStatusEmailData,
  AccountStatusEmailKind,
  AccountStatusShopNotice,
} from './account-email.types';
import { button, paragraph, renderEmail } from './order-email.layout';

interface KindCopy {
  subject: string;
  title: string;
  lead: string;
}

interface Copy {
  greeting: (name: string) => string;
  reasonLabel: string;
  supportLabel: string;
  signIn: string;
  kinds: Record<AccountStatusEmailKind, KindCopy>;
  // Mỗi câu là MỘT CÂU TRỌN VẸN (không ghép từ theo thứ tự của một ngôn ngữ).
  shopNotices: Record<AccountStatusShopNotice, string>;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    greeting: (name) => `Chào ${name},`,
    reasonLabel: 'Lý do',
    supportLabel: 'Liên hệ hỗ trợ',
    signIn: 'Đăng nhập',
    shopNotices: {
      SUSPENDED:
        'Shop của bạn cũng bị tạm ngừng: shop không còn hiển thị công khai và không nhận đơn mới.',
      REOPENED:
        'Shop của bạn cũng đã được mở lại và hiển thị công khai trở lại.',
      STILL_SUSPENDED:
        'Shop của bạn vẫn đang bị tạm ngừng và sẽ được quản trị viên xem xét riêng.',
    },
    kinds: {
      SUSPENDED: {
        subject: 'Tài khoản của bạn đã bị tạm khoá',
        title: 'Tài khoản của bạn đã bị tạm khoá',
        lead: 'Tài khoản của bạn đã bị tạm khoá nên bạn không thể đăng nhập cho tới khi được mở lại.',
      },
      BANNED: {
        subject: 'Tài khoản của bạn đã bị cấm',
        title: 'Tài khoản của bạn đã bị cấm',
        lead: 'Tài khoản của bạn đã bị cấm nên bạn không thể đăng nhập. Tài khoản chỉ có thể được mở lại sau khi quản trị viên xem xét.',
      },
      REACTIVATED: {
        subject: 'Tài khoản của bạn đã được mở lại',
        title: 'Tài khoản của bạn đã được mở lại',
        lead: 'Tài khoản của bạn đã được mở lại. Bạn có thể đăng nhập và sử dụng như bình thường.',
      },
    },
  },
  en: {
    greeting: (name) => `Hi ${name},`,
    reasonLabel: 'Reason',
    supportLabel: 'Contact support',
    signIn: 'Sign in',
    shopNotices: {
      SUSPENDED:
        'Your shop has also been suspended: it is no longer publicly visible and cannot receive new orders.',
      REOPENED:
        'Your shop has also been reinstated and is publicly visible again.',
      STILL_SUSPENDED:
        'Your shop remains suspended and will be reviewed separately by an administrator.',
    },
    kinds: {
      SUSPENDED: {
        subject: 'Your account has been suspended',
        title: 'Your account has been suspended',
        lead: 'Your account has been suspended, so you cannot sign in until it is reinstated.',
      },
      BANNED: {
        subject: 'Your account has been banned',
        title: 'Your account has been banned',
        lead: 'Your account has been banned, so you cannot sign in. It can only be restored after an administrator reviews it.',
      },
      REACTIVATED: {
        subject: 'Your account has been reinstated',
        title: 'Your account has been reinstated',
        lead: 'Your account has been reinstated. You can sign in and use it as usual.',
      },
    },
  },
};

// Báo chủ tài khoản khi Admin khoá / cấm / mở lại (Week11.md 3.3). Tên và LÝ DO đều là văn bản người ta nhập nên đi qua
// escapeHtml (html.ts); lý do nhiều dòng giữ xuống dòng bằng `white-space:pre-line` thay vì chèn thẻ <br> thô. Email khoá /
// cấm KHÔNG có nút (người nhận không đăng nhập được), chỉ email mở lại có nút "Đăng nhập".
export function accountStatusTemplate(data: AccountStatusEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const kind = copy.kinds[data.kind];
  const isLock = data.kind !== 'REACTIVATED';

  const reason = `<p style="margin:0 0 12px;white-space:pre-line"><strong>${escapeHtml(copy.reasonLabel)}:</strong> ${escapeHtml(data.reason)}</p>`;
  const support =
    isLock && data.supportEmail
      ? `<p style="margin:0 0 12px"><strong>${escapeHtml(copy.supportLabel)}:</strong> ${escapeHtml(data.supportEmail)}</p>`
      : '';
  const shopNotice = data.shopNotice
    ? paragraph(copy.shopNotices[data.shopNotice])
    : '';
  const action = isLock ? '' : button(data.loginUrl, copy.signIn);

  const html = renderEmail(
    kind.title,
    `
      ${paragraph(copy.greeting(data.name))}
      ${paragraph(kind.lead)}
      ${reason}
      ${shopNotice}
      ${support}
      ${action}
    `,
    data.locale,
  );
  return { subject: kind.subject, html };
}
