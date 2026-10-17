import type { MailLocale } from '../mail-locale';
import { formatVnd } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type {
  OrderRefundedEmailData,
  OrderRefundTarget,
} from './order-email.types';

interface Copy {
  subject: string;
  title: string;
  greeting: (name: string) => string;
  lead: (orderCode: string, shopName: string) => string;
  refundLines: Record<OrderRefundTarget, (amount: string) => string>;
  viewOrder: string;
}

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subject: 'Yêu cầu trả hàng của bạn đã được chấp nhận',
    title: 'Đã chấp nhận trả hàng và hoàn tiền',
    greeting: (name) => `Chào ${name},`,
    lead: (orderCode, shopName) =>
      `Yêu cầu trả hàng và hoàn tiền cho đơn hàng #${orderCode} của ${shopName} đã được chấp nhận.`,
    refundLines: {
      ORIGINAL_PAYMENT: (amount) =>
        `Chúng tôi đang hoàn ${amount} về phương thức thanh toán ban đầu của bạn. Thời gian tiền về tài khoản tuỳ thuộc vào ngân hàng hoặc cổng thanh toán.`,
      SHOP_CASH: (amount) =>
        `Đơn hàng được thanh toán khi nhận hàng nên shop sẽ hoàn lại ${amount} trực tiếp cho bạn bằng tiền mặt. Hệ thống không theo dõi khoản hoàn tiền mặt này — nếu chưa nhận được, hãy liên hệ shop.`,
    },
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subject: 'Your return request has been approved',
    title: 'Return and refund approved',
    greeting: (name) => `Hi ${name},`,
    lead: (orderCode, shopName) =>
      `Your return and refund request for order #${orderCode} from ${shopName} has been approved.`,
    refundLines: {
      ORIGINAL_PAYMENT: (amount) =>
        `We are refunding ${amount} to your original payment method. How long it takes to reach your account depends on your bank or the payment gateway.`,
      SHOP_CASH: (amount) =>
        `This order was paid on delivery, so the shop will refund ${amount} to you directly in cash. The marketplace does not track this cash refund — if you have not received it, please contact the shop.`,
    },
    viewOrder: 'View order',
  },
};

// Duyệt trả hàng/hoàn tiền SAU giao (COMPLETED → REFUNDED, Week9.md 1.3). Gửi ngay sau commit, lúc cổng có
// thể chưa xác nhận nên chỉ nói "đang hoàn", không khẳng định tiền đã về (như email hủy đơn).
export function orderRefundedTemplate(data: OrderRefundedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(copy.lead(data.order.orderCode, data.order.shopName))}
      ${paragraph(copy.refundLines[data.refundTo](formatVnd(data.refundAmount)))}
      ${renderOrderBlock(data.order, data.locale)}
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject: copy.subject, html };
}
