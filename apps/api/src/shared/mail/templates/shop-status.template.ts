import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';
import type {
  ShopStatusEmailData,
  ShopStatusEmailKind,
} from './account-email.types';
import { button, paragraph, renderEmail } from './order-email.layout';

interface KindCopy {
  subject: (shopName: string) => string;
  title: string;
  lead: string;
  // Câu đứng sau lý do (chỉ REJECTED/SUSPENDED có lý do).
  followUp: string | null;
  action: string;
}

interface Copy {
  greeting: (name: string) => string;
  reasonLabel: string;
  kinds: Record<ShopStatusEmailKind, KindCopy>;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    greeting: (name) => `Chào ${name},`,
    reasonLabel: 'Lý do',
    kinds: {
      APPROVED: {
        subject: (shopName) => `Shop ${shopName} đã được duyệt`,
        title: 'Shop của bạn đã được duyệt',
        lead: 'Chúc mừng! Shop của bạn đã được duyệt và bắt đầu hiển thị công khai trên sàn. Bạn có thể đăng sản phẩm và nhận đơn hàng ngay bây giờ.',
        followUp: null,
        action: 'Quản lý shop',
      },
      REJECTED: {
        subject: (shopName) => `Shop ${shopName} chưa được duyệt`,
        title: 'Shop của bạn chưa được duyệt',
        lead: 'Rất tiếc, shop của bạn chưa được duyệt.',
        followUp:
          'Bạn có thể chỉnh sửa thông tin shop theo lý do trên rồi gửi duyệt lại.',
        action: 'Chỉnh sửa shop',
      },
      SUSPENDED: {
        subject: (shopName) => `Shop ${shopName} đã bị tạm khoá`,
        title: 'Shop của bạn đã bị tạm khoá',
        lead: 'Shop của bạn đã bị tạm khoá: shop không còn hiển thị công khai và sản phẩm của shop tạm thời không bán được.',
        followUp:
          'Bạn có thể xem trạng thái hiện tại trong trang quản lý shop.',
        action: 'Xem trạng thái shop',
      },
      REINSTATED: {
        subject: (shopName) => `Shop ${shopName} đã được mở khoá`,
        title: 'Shop của bạn đã được mở khoá',
        lead: 'Shop của bạn đã được mở khoá và hiển thị công khai trở lại.',
        followUp: null,
        action: 'Quản lý shop',
      },
    },
  },
  en: {
    greeting: (name) => `Hi ${name},`,
    reasonLabel: 'Reason',
    kinds: {
      APPROVED: {
        subject: (shopName) => `Your shop ${shopName} has been approved`,
        title: 'Your shop has been approved',
        lead: 'Congratulations! Your shop has been approved and is now publicly visible on the marketplace. You can list products and start receiving orders right away.',
        followUp: null,
        action: 'Manage shop',
      },
      REJECTED: {
        subject: (shopName) => `Your shop ${shopName} was not approved`,
        title: 'Your shop was not approved',
        lead: 'Unfortunately your shop was not approved.',
        followUp:
          'You can update your shop details according to the reason above and submit it for review again.',
        action: 'Edit shop',
      },
      SUSPENDED: {
        subject: (shopName) => `Your shop ${shopName} has been suspended`,
        title: 'Your shop has been suspended',
        lead: 'Your shop has been suspended: it is no longer publicly visible and its products cannot be purchased for now.',
        followUp:
          'You can check its current status on the shop management page.',
        action: 'View shop status',
      },
      REINSTATED: {
        subject: (shopName) => `Your shop ${shopName} has been reinstated`,
        title: 'Your shop has been reinstated',
        lead: 'Your shop has been reinstated and is publicly visible again.',
        followUp: null,
        action: 'Manage shop',
      },
    },
  },
};

// Báo chủ shop khi Admin đổi trạng thái shop (Week9.md 1.13). Tên shop và LÝ DO do người dùng/Admin tự nhập
// — đi qua paragraph()/escapeHtml (html.ts), kể cả khi người nhận chính là người đã nhập tên shop.
export function shopStatusTemplate(data: ShopStatusEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const kind = copy.kinds[data.kind];
  const reason = data.reason
    ? `<p style="margin:0 0 12px"><strong>${escapeHtml(copy.reasonLabel)}:</strong> ${escapeHtml(data.reason)}</p>`
    : '';
  const followUp = kind.followUp ? paragraph(kind.followUp) : '';

  const html = renderEmail(
    kind.title,
    `
      ${paragraph(copy.greeting(data.ownerName))}
      ${paragraph(kind.lead)}
      <p style="margin:0 0 12px"><strong>${escapeHtml(data.shopName)}</strong></p>
      ${reason}
      ${followUp}
      ${button(data.shopUrl, kind.action)}
    `,
    data.locale,
  );
  return { subject: kind.subject(data.shopName), html };
}
