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

// Đơn bị hủy (seller từ chối / buyer hủy / hết hạn thanh toán). Từ Tuần 9 đơn đã thanh toán online cũng hủy
// được: khi đó có thêm đoạn "đang hoàn tiền" (refundAmount). Email gửi ngay sau khi hủy, lúc cổng có thể
// chưa xác nhận nên chỉ nói "đang hoàn", không khẳng định tiền đã về.
export function orderCancelledTemplate(data: OrderCancelledEmailData): {
  subject: string;
  html: string;
} {
  const subject = SUBJECTS[data.cancelledBy];
  // Lý do do seller/buyer tự nhập — escape (xem html.ts).
  const reason = data.reason
    ? `<p style="margin:0 0 12px"><strong>Lý do:</strong> ${escapeHtml(data.reason)}</p>`
    : '';
  const refund =
    data.refundAmount && data.refundAmount > 0
      ? paragraph(
          `Chúng tôi đang hoàn ${formatVnd(data.refundAmount)} về phương thức thanh toán ban đầu của bạn. Thời gian tiền về tài khoản tuỳ thuộc vào ngân hàng hoặc cổng thanh toán.`,
        )
      : '';

  const html = renderEmail(
    'Đơn hàng đã bị hủy',
    `
      ${paragraph(`Chào ${data.buyerName},`)}
      ${paragraph(LEADS[data.cancelledBy])}
      ${reason}
      ${refund}
      ${data.orders.map(renderOrderBlock).join('')}
      ${button(data.ordersUrl, 'Xem đơn hàng')}
    `,
  );
  return { subject, html };
}
