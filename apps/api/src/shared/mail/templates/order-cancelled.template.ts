import type { MailLocale } from '../mail-locale';
import { escapeHtml, formatVnd } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type {
  OrderCancelledBy,
  OrderCancelledEmailData,
} from './order-email.types';

interface Copy {
  subjects: Record<OrderCancelledBy, string>;
  leads: Record<OrderCancelledBy, string>;
  title: string;
  greeting: (name: string) => string;
  reasonLabel: string;
  refund: (amount: string) => string;
  viewOrder: string;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subjects: {
      SELLER: 'Đơn hàng của bạn đã bị shop từ chối',
      BUYER: 'Bạn đã hủy đơn hàng',
      SYSTEM: 'Đơn hàng đã bị hủy do hết hạn thanh toán',
      ADMIN: 'Đơn hàng của bạn đã bị quản trị viên hủy',
    },
    leads: {
      SELLER:
        'Rất tiếc, shop không thể thực hiện đơn hàng của bạn nên đơn đã bị hủy.',
      BUYER: 'Đơn hàng của bạn đã được hủy theo yêu cầu của bạn.',
      SYSTEM:
        'Đơn hàng chưa được thanh toán trong thời hạn giữ hàng nên đã bị hủy và hàng đã được trả lại kho.',
      ADMIN:
        'Rất tiếc, đơn hàng của bạn đã bị quản trị viên của sàn hủy vì shop này đang bị tạm ngừng hoạt động.',
    },
    title: 'Đơn hàng đã bị hủy',
    greeting: (name) => `Chào ${name},`,
    reasonLabel: 'Lý do',
    refund: (amount) =>
      `Chúng tôi đang hoàn ${amount} về phương thức thanh toán ban đầu của bạn. Thời gian tiền về tài khoản tuỳ thuộc vào ngân hàng hoặc cổng thanh toán.`,
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subjects: {
      SELLER: 'The shop has declined your order',
      BUYER: 'You cancelled your order',
      SYSTEM: 'Your order was cancelled because the payment expired',
      ADMIN: 'Your order was cancelled by a marketplace administrator',
    },
    leads: {
      SELLER:
        'Unfortunately the shop is unable to fulfil your order, so it has been cancelled.',
      BUYER: 'Your order has been cancelled at your request.',
      SYSTEM:
        'Your order was not paid within the hold period, so it has been cancelled and the items returned to stock.',
      ADMIN:
        'Unfortunately a marketplace administrator has cancelled your order because this shop is currently suspended.',
    },
    title: 'Your order has been cancelled',
    greeting: (name) => `Hi ${name},`,
    reasonLabel: 'Reason',
    refund: (amount) =>
      `We are refunding ${amount} to your original payment method. How long it takes to reach your account depends on your bank or the payment gateway.`,
    viewOrder: 'View order',
  },
};

// Đơn bị hủy (seller từ chối / buyer hủy / hết hạn thanh toán / Admin hủy). Từ Tuần 9 đơn đã thanh toán online cũng hủy
// được: khi đó có thêm đoạn "đang hoàn tiền" (refundAmount). Email gửi ngay sau khi hủy, lúc cổng có thể
// chưa xác nhận nên chỉ nói "đang hoàn", không khẳng định tiền đã về.
export function orderCancelledTemplate(data: OrderCancelledEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const subject = copy.subjects[data.cancelledBy];
  // Lý do do seller/buyer/Admin tự nhập — escape (xem html.ts).
  const reason = data.reason
    ? `<p style="margin:0 0 12px"><strong>${escapeHtml(copy.reasonLabel)}:</strong> ${escapeHtml(data.reason)}</p>`
    : '';
  const refund =
    data.refundAmount && data.refundAmount > 0
      ? paragraph(copy.refund(formatVnd(data.refundAmount)))
      : '';

  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(copy.leads[data.cancelledBy])}
      ${reason}
      ${refund}
      ${data.orders.map((order) => renderOrderBlock(order, data.locale)).join('')}
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject, html };
}
