import type { MailLocale } from '../mail-locale';
import { escapeHtml, formatVnd } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderPlacedEmailData } from './order-email.types';

interface Copy {
  subjectCod: string;
  subjectOnline: string;
  greeting: (name: string) => string;
  leadCod: (total: string) => string;
  leadOnline: (total: string) => string;
  deliverTo: string;
  viewOrder: string;
}

// `Record<MailLocale, Copy>`: thêm ngôn ngữ mà thiếu bản dịch là lỗi biên dịch (Week9.md 1.12).
const COPY: Record<MailLocale, Copy> = {
  vi: {
    subjectCod: 'Đặt hàng thành công — thanh toán khi nhận hàng',
    subjectOnline: 'Thanh toán thành công — đơn hàng đang chờ shop xác nhận',
    greeting: (name) => `Chào ${name},`,
    leadCod: (total) =>
      `Đơn hàng của bạn đã được ghi nhận. Bạn sẽ thanh toán ${total} khi nhận hàng.`,
    leadOnline: (total) =>
      `Chúng tôi đã nhận được thanh toán ${total}. Shop sẽ sớm xác nhận đơn hàng của bạn.`,
    deliverTo: 'Giao tới',
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subjectCod: 'Order placed — pay on delivery',
    subjectOnline:
      'Payment received — your order is waiting for the shop to confirm',
    greeting: (name) => `Hi ${name},`,
    leadCod: (total) =>
      `Your order has been placed. You will pay ${total} on delivery.`,
    leadOnline: (total) =>
      `We have received your payment of ${total}. The shop will confirm your order shortly.`,
    deliverTo: 'Deliver to',
    viewOrder: 'View order',
  },
};

// Đặt hàng thành công. 2 cách diễn đạt: COD (chưa trả tiền, trả khi nhận hàng) và đã thanh toán online.
export function orderPlacedTemplate(data: OrderPlacedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const isCod = data.paymentMethod === 'COD';
  const grandTotal = formatVnd(
    data.orders.reduce((sum, o) => sum + o.totalAmount, 0),
  );
  const subject = isCod ? copy.subjectCod : copy.subjectOnline;
  const lead = isCod ? copy.leadCod(grandTotal) : copy.leadOnline(grandTotal);

  const html = renderEmail(
    subject,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(lead)}
      ${data.orders.map((order) => renderOrderBlock(order, data.locale)).join('')}
      <p style="margin:0 0 4px"><strong>${escapeHtml(copy.deliverTo)}</strong></p>
      <p style="margin:0 0 12px">${escapeHtml(data.recipient.name)} · ${escapeHtml(data.recipient.phone)}<br>${escapeHtml(data.recipient.address)}</p>
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject, html };
}
