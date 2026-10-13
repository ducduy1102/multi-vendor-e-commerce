import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderShippedEmailData } from './order-email.types';

interface Copy {
  subject: string;
  title: string;
  greeting: (name: string) => string;
  lead: (orderCode: string, shopName: string) => string;
  carrier: string;
  trackingCode: string;
  viewOrder: string;
}

// Nhãn nút "Đã nhận hàng"/"Mark as received" khớp `order.actionConfirmReceived` ở messages của FE.
const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: 'Đơn hàng của bạn đang được giao',
    title: 'Đơn hàng đang trên đường giao',
    greeting: (name) => `Chào ${name},`,
    lead: (orderCode, shopName) =>
      `Đơn hàng #${orderCode} của ${shopName} đã được giao cho đơn vị vận chuyển. Vui lòng bấm "Đã nhận hàng" trong trang đơn hàng sau khi nhận được hàng.`,
    carrier: 'Đơn vị vận chuyển',
    trackingCode: 'Mã vận đơn',
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subject: 'Your order is on its way',
    title: 'Your order is on the way',
    greeting: (name) => `Hi ${name},`,
    lead: (orderCode, shopName) =>
      `Order #${orderCode} from ${shopName} has been handed to the carrier. Please click "Mark as received" on the order page once your items arrive.`,
    carrier: 'Carrier',
    trackingCode: 'Tracking code',
    viewOrder: 'View order',
  },
};

// Đơn đã giao cho đơn vị vận chuyển (PACKED → SHIPPING). Đơn vị vận chuyển/mã vận đơn do seller nhập
// tay và đều tuỳ chọn (Week8.md 1.10) — chỉ hiện dòng nào có.
export function orderShippedTemplate(data: OrderShippedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const shipping = [
    data.carrier
      ? `${escapeHtml(copy.carrier)}: <strong>${escapeHtml(data.carrier)}</strong>`
      : '',
    data.trackingCode
      ? `${escapeHtml(copy.trackingCode)}: <strong>${escapeHtml(data.trackingCode)}</strong>`
      : '',
  ]
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 4px">${line}</p>`)
    .join('');

  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(copy.lead(data.order.orderCode, data.order.shopName))}
      ${shipping}
      ${renderOrderBlock(data.order, data.locale)}
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject: copy.subject, html };
}
