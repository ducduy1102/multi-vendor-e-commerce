import { escapeHtml, formatVnd } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type { OrderPlacedEmailData } from './order-email.types';

// Đặt hàng thành công. 2 cách diễn đạt: COD (chưa trả tiền, trả khi nhận hàng) và đã thanh toán online.
export function orderPlacedTemplate(data: OrderPlacedEmailData): {
  subject: string;
  html: string;
} {
  const isCod = data.paymentMethod === 'COD';
  const grandTotal = data.orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const subject = isCod
    ? 'Đặt hàng thành công — thanh toán khi nhận hàng'
    : 'Thanh toán thành công — đơn hàng đang chờ shop xác nhận';
  const lead = isCod
    ? `Đơn hàng của bạn đã được ghi nhận. Bạn sẽ thanh toán ${formatVnd(grandTotal)} khi nhận hàng.`
    : `Chúng tôi đã nhận được thanh toán ${formatVnd(grandTotal)}. Shop sẽ sớm xác nhận đơn hàng của bạn.`;

  const html = renderEmail(
    subject,
    `
      ${paragraph(`Chào ${data.buyerName},`)}
      ${paragraph(lead)}
      ${data.orders.map(renderOrderBlock).join('')}
      <p style="margin:0 0 4px"><strong>Giao tới</strong></p>
      <p style="margin:0 0 12px">${escapeHtml(data.recipient.name)} · ${escapeHtml(data.recipient.phone)}<br>${escapeHtml(data.recipient.address)}</p>
      ${button(data.ordersUrl, 'Xem đơn hàng')}
    `,
  );
  return { subject, html };
}
