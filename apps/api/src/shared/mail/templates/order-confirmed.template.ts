import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderConfirmedEmailData } from './order-email.types';

// Shop đã xác nhận đơn (PENDING → CONFIRMED).
export function orderConfirmedTemplate(data: OrderConfirmedEmailData): {
  subject: string;
  html: string;
} {
  const subject = `${data.order.shopName} đã xác nhận đơn hàng của bạn`;
  const html = renderEmail(
    'Đơn hàng đã được xác nhận',
    `
      ${paragraph(`Chào ${data.buyerName},`)}
      ${paragraph(`Shop ${data.order.shopName} đã xác nhận đơn hàng #${data.order.orderCode} và đang chuẩn bị hàng cho bạn.`)}
      ${renderOrderBlock(data.order)}
      ${button(data.ordersUrl, 'Xem đơn hàng')}
    `,
  );
  return { subject, html };
}
