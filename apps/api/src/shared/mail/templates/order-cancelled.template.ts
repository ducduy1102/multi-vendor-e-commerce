import { escapeHtml } from './html';
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

const SUBJECTS: Record<OrderCancelledBy, string> = {
  SELLER: 'Đơn hàng của bạn đã bị shop từ chối',
  BUYER: 'Bạn đã hủy đơn hàng',
  SYSTEM: 'Đơn hàng đã bị hủy do hết hạn thanh toán',
};

const LEADS: Record<OrderCancelledBy, string> = {
  SELLER:
    'Rất tiếc, shop không thể thực hiện đơn hàng của bạn nên đơn đã bị hủy.',
  BUYER: 'Đơn hàng của bạn đã được hủy theo yêu cầu của bạn.',
  SYSTEM:
    'Đơn hàng chưa được thanh toán trong thời hạn giữ hàng nên đã bị hủy và hàng đã được trả lại kho.',
};

// Đơn bị hủy (seller từ chối / buyer hủy / hết hạn thanh toán). Chỉ gửi cho các đường hủy KHÔNG có tiền
// thật (Week8.md 1.5) nên không có đoạn hoàn tiền; hủy kèm hoàn tiền là Tuần 9.
export function orderCancelledTemplate(data: OrderCancelledEmailData): {
  subject: string;
  html: string;
} {
  const subject = SUBJECTS[data.cancelledBy];
  // Lý do do seller/buyer tự nhập — escape (xem html.ts).
  const reason = data.reason
    ? `<p style="margin:0 0 12px"><strong>Lý do:</strong> ${escapeHtml(data.reason)}</p>`
    : '';

  const html = renderEmail(
    'Đơn hàng đã bị hủy',
    `
      ${paragraph(`Chào ${data.buyerName},`)}
      ${paragraph(LEADS[data.cancelledBy])}
      ${reason}
      ${data.orders.map(renderOrderBlock).join('')}
      ${button(data.ordersUrl, 'Xem đơn hàng')}
    `,
  );
  return { subject, html };
}
