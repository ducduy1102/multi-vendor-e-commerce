import type { MailLocale } from '../mail-locale';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderConfirmedEmailData } from './order-email.types';

interface Copy {
  subject: (shopName: string) => string;
  title: string;
  greeting: (name: string) => string;
  lead: (shopName: string, orderCode: string) => string;
  viewOrder: string;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: (shopName) => `${shopName} đã xác nhận đơn hàng của bạn`,
    title: 'Đơn hàng đã được xác nhận',
    greeting: (name) => `Chào ${name},`,
    lead: (shopName, orderCode) =>
      `Shop ${shopName} đã xác nhận đơn hàng #${orderCode} và đang chuẩn bị hàng cho bạn.`,
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subject: (shopName) => `${shopName} has confirmed your order`,
    title: 'Your order has been confirmed',
    greeting: (name) => `Hi ${name},`,
    lead: (shopName, orderCode) =>
      `${shopName} has confirmed order #${orderCode} and is preparing your items.`,
    viewOrder: 'View order',
  },
};

// Shop đã xác nhận đơn (PENDING → CONFIRMED).
export function orderConfirmedTemplate(data: OrderConfirmedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const subject = copy.subject(data.order.shopName);
  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(copy.lead(data.order.shopName, data.order.orderCode))}
      ${renderOrderBlock(data.order, data.locale)}
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject, html };
}
