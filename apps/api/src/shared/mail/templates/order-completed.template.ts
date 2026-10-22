import type { MailLocale } from '../mail-locale';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type {
  OrderCompletedBy,
  OrderCompletedEmailData,
} from './order-email.types';

interface Copy {
  subjects: Record<OrderCompletedBy, (orderCode: string) => string>;
  title: string;
  greeting: (name: string) => string;
  leads: Record<
    OrderCompletedBy,
    (shopName: string, orderCode: string, autoCompleteDays: number) => string
  >;
  returnNote: (days: number) => string;
  reviewInvite: string;
  reviewButton: string;
  viewOrder: string;
}

// "N ngày" / "1 day" / "N days": tiếng Anh cần số ít khi N = 1.
const daysEn = (n: number) => (n === 1 ? '1 day' : `${n} days`);

const COPY: Record<MailLocale, Copy> = {
  vi: {
    subjects: {
      BUYER: (code) => `Đơn hàng #${code} đã hoàn tất`,
      SYSTEM: (code) => `Đơn hàng #${code} đã được tự động hoàn tất`,
    },
    title: 'Đơn hàng đã hoàn tất',
    greeting: (name) => `Chào ${name},`,
    leads: {
      BUYER: (shopName, code) =>
        `Cảm ơn bạn đã xác nhận đã nhận hàng. Đơn hàng #${code} từ shop ${shopName} đã hoàn tất.`,
      SYSTEM: (shopName, code, days) =>
        `Đơn hàng #${code} từ shop ${shopName} đã được giao nhưng chưa được bạn xác nhận sau ${days} ngày, nên hệ thống đã tự động hoàn tất đơn hàng.`,
    },
    returnNote: (days) =>
      `Nếu hàng có vấn đề, bạn vẫn có thể gửi yêu cầu trả hàng/hoàn tiền từ trang đơn hàng trong ${days} ngày kể từ hôm nay.`,
    reviewInvite:
      'Hãy dành ít phút đánh giá sản phẩm để giúp những người mua khác lựa chọn tốt hơn.',
    reviewButton: 'Đánh giá sản phẩm',
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    subjects: {
      BUYER: (code) => `Order #${code} is complete`,
      SYSTEM: (code) => `Order #${code} was completed automatically`,
    },
    title: 'Your order is complete',
    greeting: (name) => `Hi ${name},`,
    leads: {
      BUYER: (shopName, code) =>
        `Thanks for confirming that you received your items. Order #${code} from ${shopName} is complete.`,
      SYSTEM: (shopName, code, days) =>
        `Order #${code} from ${shopName} was delivered but you did not confirm receipt within ${daysEn(days)}, so we completed it automatically.`,
    },
    returnNote: (days) =>
      `If there is a problem with your items, you can still request a return or refund from the order page within ${daysEn(days)} from today.`,
    reviewInvite:
      'Take a minute to review your items and help other shoppers choose.',
    reviewButton: 'Review products',
    viewOrder: 'View order',
  },
};

// Đơn đã hoàn tất (SHIPPING → COMPLETED): người mua tự bấm "đã nhận hàng", hoặc hệ thống tự hoàn tất sau N ngày không
// xác nhận (Week8.md 1.7). Nhánh tự hoàn tất nói rõ lý do và số ngày để người mua không ngạc nhiên; cả hai nhắc cửa sổ
// trả hàng/hoàn tiền còn lại. Lời mời đánh giá chỉ hiện khi còn sản phẩm chưa được đánh giá (`invitesReview`).
export function orderCompletedTemplate(data: OrderCompletedEmailData): {
  subject: string;
  html: string;
} {
  const copy = COPY[data.locale];
  const subject = copy.subjects[data.completedBy](data.order.orderCode);
  const invite = data.invitesReview ? paragraph(copy.reviewInvite) : '';
  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(
        copy.leads[data.completedBy](
          data.order.shopName,
          data.order.orderCode,
          data.autoCompleteDays,
        ),
      )}
      ${renderOrderBlock(data.order, data.locale)}
      ${paragraph(copy.returnNote(data.returnWindowDays))}
      ${invite}
      ${button(data.ordersUrl, data.invitesReview ? copy.reviewButton : copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject, html };
}
