import { escapeHtml } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderShippedEmailData } from './order-email.types';

// Đơn đã giao cho đơn vị vận chuyển (PACKED → SHIPPING). Đơn vị vận chuyển/mã vận đơn do seller nhập
// tay và đều tuỳ chọn (Week8.md 1.10) — chỉ hiện dòng nào có.
export function orderShippedTemplate(data: OrderShippedEmailData): {
  subject: string;
  html: string;
} {
  const subject = 'Đơn hàng của bạn đang được giao';
  const shipping = [
    data.carrier
      ? `Đơn vị vận chuyển: <strong>${escapeHtml(data.carrier)}</strong>`
      : '',
    data.trackingCode
      ? `Mã vận đơn: <strong>${escapeHtml(data.trackingCode)}</strong>`
      : '',
  ]
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 4px">${line}</p>`)
    .join('');

  const html = renderEmail(
    'Đơn hàng đang trên đường giao',
    `
      ${paragraph(`Chào ${data.buyerName},`)}
      ${paragraph(`Đơn hàng #${data.order.orderCode} của ${data.order.shopName} đã được giao cho đơn vị vận chuyển. Vui lòng bấm "Đã nhận hàng" trong trang đơn hàng sau khi nhận được hàng.`)}
      ${shipping}
      ${renderOrderBlock(data.order)}
      ${button(data.ordersUrl, 'Xem đơn hàng')}
    `,
  );
  return { subject, html };
}
